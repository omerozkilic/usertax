import type { App, Asset, Compression, JsBundle, Lighthouse, Platform } from './schema.js';
import { summarize } from './stats.js';

export type MetricUnit = 'bytes' | 'ms' | 'score' | 'unitless';
export type MetricGroup = 'web' | 'route' | 'bundle' | 'archive' | 'lighthouse' | 'package';
export type MetricDirection = 'lower-is-better' | 'higher-is-better';
export type LighthouseMetricName = 'performance' | 'lcp' | 'tbt' | 'cls';

/**
 * A single comparable number derived from a report. Metric ids are stable, dot-separated paths;
 * free-text parts (routes, URLs, keys) are wrapped in brackets:
 *
 * - `js.total.gzip`, `css.total.brotli`
 * - `route[/pricing].js.gzip`, `route[/pricing].css.gzip`, `route[/pricing].images.bytes`
 * - `bundle[ios].raw`
 * - `archive[android].file`, `archive[android].category.dex`
 * - `lighthouse[/][mobile].lcp`
 * - `package[lodash].bytes`, `package[lodash][android].bytes` (minified bytes per bundle)
 *
 * Budgets select metrics with glob patterns such as `route[*].js.gzip`.
 */
export interface Metric {
  readonly id: string;
  readonly group: MetricGroup;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly direction: MetricDirection;
  /** The value compared between base and head (the median for repeated measurements). */
  readonly value: number;
  /** Set for byte sizes that exist in raw / gzip / brotli variants. */
  readonly compression?: Compression;
  /** Individual measurements, for noisy metrics. */
  readonly samples?: readonly number[];
  /** Key into the noise parameters (ADR 0007), for noisy metrics. */
  readonly noiseKey?: LighthouseMetricName;
  /** Origins of browser extensions that were active in at least one run (not comparable). */
  readonly contamination?: readonly string[];
  /**
   * For package metrics, the bundle they belong to. A package missing on one side of a comparison
   * has 0 bytes there, provided that side's bundle was attributed at all.
   */
  readonly packageScope?: PackageScope;
}

interface SizeTotals {
  raw: number;
  gzip?: number | undefined;
  brotli?: number | undefined;
}

function sumSizes(items: readonly SizeTotals[]): SizeTotals {
  const totals: SizeTotals = { raw: 0 };
  let gzip = 0;
  let brotli = 0;
  let allGzip = true;
  let allBrotli = true;
  for (const item of items) {
    totals.raw += item.raw;
    if (item.gzip === undefined) allGzip = false;
    else gzip += item.gzip;
    if (item.brotli === undefined) allBrotli = false;
    else brotli += item.brotli;
  }
  if (allGzip) totals.gzip = gzip;
  if (allBrotli) totals.brotli = brotli;
  return totals;
}

function sizeMetrics(
  idPrefix: string,
  label: string,
  group: MetricGroup,
  totals: SizeTotals,
): Metric[] {
  const metrics: Metric[] = [];
  for (const compression of ['raw', 'gzip', 'brotli'] as const) {
    const value = totals[compression];
    if (value !== undefined) {
      metrics.push({
        id: `${idPrefix}.${compression}`,
        group,
        label,
        unit: 'bytes',
        direction: 'lower-is-better',
        value,
        compression,
      });
    }
  }
  return metrics;
}

const PLATFORM_LABEL: Record<Platform, string> = { ios: 'iOS', android: 'Android' };

/** Where attributed bytes ship: the web app's JavaScript, or one mobile JS bundle. */
export type PackageScope = 'web' | Platform;

/** The files of an app that carry source-map attribution, with the scope they ship in. */
export function attributedFiles(
  app: App | undefined,
): { scope: PackageScope; item: Asset | JsBundle }[] {
  return [
    ...(app?.assets ?? [])
      .filter((a) => a.type === 'js')
      .map((a) => ({ scope: 'web' as const, item: a })),
    ...(app?.bundles ?? []).map((b) => ({ scope: b.platform, item: b })),
  ];
}

/** Minified bytes per package (`null` for first-party code), per scope, from source maps. */
export function packageTotals(app: App | undefined): Map<PackageScope, Map<string | null, number>> {
  const totals = new Map<PackageScope, Map<string | null, number>>();
  const add = (scope: PackageScope, name: string | null, bytes: number) => {
    const byName = totals.get(scope) ?? new Map<string | null, number>();
    totals.set(scope, byName);
    byName.set(name, (byName.get(name) ?? 0) + bytes);
  };
  for (const { scope, item } of attributedFiles(app)) {
    for (const pkg of item.packages ?? []) add(scope, pkg.name, pkg.bytes);
    if (item.firstPartyBytes !== undefined) add(scope, null, item.firstPartyBytes);
  }
  return totals;
}

/** `package[<name>].bytes` for web JavaScript, `package[<name>][<platform>].bytes` for bundles. */
function packageMetrics(app: App): Metric[] {
  const metrics: Metric[] = [];
  for (const [scope, byName] of packageTotals(app)) {
    for (const [name, bytes] of byName) {
      if (name === null) continue;
      const web = scope === 'web';
      metrics.push({
        id: web ? `package[${name}].bytes` : `package[${name}][${scope}].bytes`,
        group: 'package',
        label: web
          ? `Package ${name} (minified)`
          : `Package ${name} (${PLATFORM_LABEL[scope]}, minified)`,
        unit: 'bytes',
        direction: 'lower-is-better',
        value: bytes,
        packageScope: scope,
      });
    }
  }
  return metrics;
}

function assetMetrics(assets: readonly Asset[]): Metric[] {
  const js = assets.filter((asset) => asset.type === 'js');
  const css = assets.filter((asset) => asset.type === 'css');
  return [
    ...(js.length > 0 ? sizeMetrics('js.total', 'JS total', 'web', sumSizes(js)) : []),
    ...(css.length > 0 ? sizeMetrics('css.total', 'CSS total', 'web', sumSizes(css)) : []),
  ];
}

/**
 * Bytes of the images or fonts a route references. They are compressed formats already, so only
 * the file size counts; routes without such files get no metric.
 */
function mediaMetric(
  route: string,
  name: 'images' | 'fonts',
  label: string,
  loaded: readonly Asset[],
  type: 'image' | 'font',
): Metric[] {
  const files = loaded.filter((asset) => asset.type === type);
  if (files.length === 0) return [];
  return [
    {
      id: `route[${route}].${name}.bytes`,
      group: 'route',
      label: `${label} for ${route}`,
      unit: 'bytes',
      direction: 'lower-is-better',
      value: files.reduce((sum, asset) => sum + asset.raw, 0),
    },
  ];
}

function routeMetrics(app: App): Metric[] {
  const byKey = new Map((app.assets ?? []).map((asset) => [asset.key, asset]));
  return (app.routes ?? []).flatMap((route) => {
    const loaded = [...new Set(route.assets)]
      .map((key) => byKey.get(key))
      .filter((asset): asset is Asset => asset !== undefined);
    const js = loaded.filter((asset) => asset.type === 'js');
    // Only routes that load a stylesheet get CSS rows, so reports without CSS do not change.
    const css = loaded.filter((asset) => asset.type === 'css');
    return [
      ...sizeMetrics(`route[${route.route}].js`, `JS for ${route.route}`, 'route', sumSizes(js)),
      ...(css.length > 0
        ? sizeMetrics(`route[${route.route}].css`, `CSS for ${route.route}`, 'route', sumSizes(css))
        : []),
      ...mediaMetric(route.route, 'images', 'Images', loaded, 'image'),
      ...mediaMetric(route.route, 'fonts', 'Fonts', loaded, 'font'),
    ];
  });
}

function bundleMetrics(bundles: readonly JsBundle[]): Metric[] {
  return bundles.flatMap((bundle) =>
    sizeMetrics(
      `bundle[${bundle.platform}]`,
      `${PLATFORM_LABEL[bundle.platform]} JS bundle (${bundle.format === 'hermes' ? 'Hermes bytecode' : 'JS'})`,
      'bundle',
      bundle,
    ),
  );
}

function archiveMetrics(app: App): Metric[] {
  return (app.archives ?? []).flatMap((archive) => [
    {
      id: `archive[${archive.key}].file`,
      group: 'archive' as const,
      label: `${PLATFORM_LABEL[archive.platform]} ${archive.format.toUpperCase()} (${archive.key})`,
      unit: 'bytes' as const,
      direction: 'lower-is-better' as const,
      value: archive.fileSize,
    },
    ...archive.categories.map((category) => ({
      id: `archive[${archive.key}].category.${category.category}`,
      group: 'archive' as const,
      label: `${archive.key}: ${category.category} (compressed)`,
      unit: 'bytes' as const,
      direction: 'lower-is-better' as const,
      value: category.compressed,
    })),
  ]);
}

const LIGHTHOUSE_METRICS: readonly {
  name: LighthouseMetricName;
  label: string;
  unit: MetricUnit;
  direction: MetricDirection;
}[] = [
  { name: 'performance', label: 'Performance score', unit: 'score', direction: 'higher-is-better' },
  { name: 'lcp', label: 'LCP', unit: 'ms', direction: 'lower-is-better' },
  { name: 'tbt', label: 'TBT', unit: 'ms', direction: 'lower-is-better' },
  { name: 'cls', label: 'CLS', unit: 'unitless', direction: 'lower-is-better' },
];

function lighthouseMetrics(entries: readonly Lighthouse[]): Metric[] {
  return entries.flatMap((entry) =>
    LIGHTHOUSE_METRICS.map((metric) => {
      // Medians are taken per metric, not from a single "median run".
      const samples = entry.runs.map((run) => run[metric.name]);
      const origins = [
        ...new Set(entry.runs.flatMap((run) => run.contamination?.origins ?? [])),
      ].sort();
      return {
        id: `lighthouse[${entry.url}][${entry.formFactor}].${metric.name}`,
        group: 'lighthouse' as const,
        label: `${metric.label} (${entry.url}, ${entry.formFactor})`,
        unit: metric.unit,
        direction: metric.direction,
        value: summarize(samples).median,
        samples,
        noiseKey: metric.name,
        ...(origins.length > 0 ? { contamination: origins } : {}),
      };
    }),
  );
}

/** Derives every comparable metric of one app. */
export function extractMetrics(app: App): Metric[] {
  return [
    ...assetMetrics(app.assets ?? []),
    ...routeMetrics(app),
    ...bundleMetrics(app.bundles ?? []),
    ...archiveMetrics(app),
    ...lighthouseMetrics(app.lighthouse ?? []),
    ...packageMetrics(app),
  ];
}
