import { alternativesFor } from './alternatives.js';
import type { Alternatives } from './alternatives.js';
import { diffDependencies } from './dependencies.js';
import type { DependencyChange } from './dependencies.js';
import { extractMetrics } from './metrics.js';
import type {
  LighthouseMetricName,
  Metric,
  MetricDirection,
  MetricGroup,
  MetricUnit,
} from './metrics.js';
import type {
  App,
  Archive,
  ArchiveCategory,
  Asset,
  AssetType,
  Compression,
  Report,
} from './schema.js';

type ArchiveEntry = Archive['entries'][number];
import { summarize } from './stats.js';
import type { SampleSummary } from './stats.js';

export const DIFF_SCHEMA_VERSION = 1;

/** Noise threshold for one noisy metric (ADR 0007). */
export interface NoiseThreshold {
  /** Smallest absolute change of the median that can count as significant. */
  readonly floor: number;
  /** Multiplier of the pooled interquartile range. */
  readonly k: number;
}

/** Per-metric thresholds; `null` turns the assessment off for that metric. */
export type NoiseThresholds = Partial<
  Record<LighthouseMetricName, NoiseThreshold | null | undefined>
>;

/**
 * Defaults derived from the 2026-11-03 calibration (docs/benchmarks, ADR 0007): 3 GitHub-hosted
 * runners × 30 Lighthouse 13.6.0 runs (mobile, simulated throttling) of two example pages. With
 * 5 runs per side and base and head from different runners, these floors keep the false-positive
 * rate at or below 0.5 % for every metric of both pages. CLS showed no variation, so it has no
 * floor; the k × IQR term scales the threshold for noisier pages.
 */
/**
 * Calibrated on GitHub-hosted runners (ADR 0007, docs/benchmarks): each floor is the smallest of
 * the tested ones that gave no false positive on 14 real reports of unchanged pages from
 * different runners (182 pairs) and in the simulation from two calibration runs (6 runners).
 */
export const DEFAULT_NOISE_THRESHOLDS: Readonly<Record<LighthouseMetricName, NoiseThreshold>> = {
  performance: { floor: 2, k: 1.5 },
  lcp: { floor: 40, k: 1.5 },
  tbt: { floor: 130, k: 1.5 },
  cls: { floor: 0, k: 1.5 },
};

export interface DiffOptions {
  /**
   * Thresholds for noisy metrics, merged over {@link DEFAULT_NOISE_THRESHOLDS}. A metric set to
   * `null` has no threshold: its changes are reported as `unassessed` rather than guessed.
   */
  readonly noise?: NoiseThresholds;
  /** Number of files, packages and archive entries listed per app. Defaults to 10. */
  readonly top?: number;
  /** Compression used to rank files and packages. Defaults to `gzip`. */
  readonly rankBy?: Compression;
}

export type Change = 'added' | 'removed' | 'increased' | 'decreased' | 'unchanged';
/**
 * - `exact`: deterministic measurement; any change is real.
 * - `significant` / `within-noise`: repeated measurement compared against a noise threshold.
 * - `unassessed`: repeated measurement without a configured threshold.
 * - `not-comparable`: missing on one side.
 */
export type Significance =
  'exact' | 'significant' | 'within-noise' | 'unassessed' | 'not-comparable';
export type Verdict = 'better' | 'worse' | 'neutral' | 'unknown';

export interface MetricDiff {
  readonly id: string;
  readonly group: MetricGroup;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly direction: MetricDirection;
  readonly compression?: Compression;
  readonly base?: number;
  readonly head?: number;
  readonly delta?: number;
  /** Relative change in percent; undefined when the base is zero or missing. */
  readonly percent?: number;
  readonly change: Change;
  readonly significance: Significance;
  readonly verdict: Verdict;
  readonly spread?: { readonly base?: SampleSummary; readonly head?: SampleSummary };
  readonly threshold?: number;
}

export interface SizeDelta {
  readonly raw: number;
  readonly gzip?: number;
  readonly brotli?: number;
}

export interface AssetDiff {
  readonly key: string;
  readonly type: AssetType;
  readonly change: Change;
  readonly baseFile?: string;
  readonly headFile?: string;
  readonly base?: SizeDelta;
  readonly head?: SizeDelta;
  readonly delta: SizeDelta;
}

/**
 * Why a package's bundle bytes changed, from the lockfiles (ADR 0008). `no-version-change`
 * means the lockfiles agree on its versions, so the change comes from how much of it is
 * imported (or from a dependency that moved into or out of the bundle).
 */
export type PackageCause = DependencyChange | { readonly kind: 'no-version-change' };

export interface PackageDiff {
  /** `web` for browser bundles, otherwise the mobile platform. */
  readonly scope: 'web' | 'ios' | 'android';
  /** npm package name, or `null` for first-party code. */
  readonly name: string | null;
  readonly base: number;
  readonly head: number;
  readonly delta: number;
  readonly change: Change;
  /** Set when both reports carry a dependency snapshot. */
  readonly cause?: PackageCause;
  /** Curated alternatives, for packages that were added or grew. */
  readonly alternatives?: Alternatives;
}

export interface ArchiveEntryDiff {
  readonly archive: string;
  readonly path: string;
  readonly category: ArchiveCategory;
  readonly change: Change;
  readonly base: number;
  readonly head: number;
  /** Change of the compressed size. */
  readonly delta: number;
}

export interface AppDiff {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: App['kind'];
  readonly framework: App['framework'];
  /** `added` / `removed` when the app exists on one side only. */
  readonly status: 'added' | 'removed' | 'compared' | 'head-only';
  /** The base app's id when its id changed and it was matched by its path instead. */
  readonly previousId?: string;
  readonly metrics: readonly MetricDiff[];
  readonly assets: readonly AssetDiff[];
  readonly packages: readonly PackageDiff[];
  readonly archiveEntries: readonly ArchiveEntryDiff[];
  /**
   * Lockfile changes not explained by the package list above (dev tooling, packages that are
   * not bundled, or packages whose bytes did not change). Empty without dependency snapshots.
   */
  readonly dependencies: readonly DependencyChange[];
  /** Counts of items left out of the lists above. */
  readonly omitted: {
    readonly assets: number;
    readonly packages: number;
    readonly archiveEntries: number;
    readonly dependencies: number;
  };
}

export interface ReportRef {
  readonly sha?: string;
  readonly ref?: string;
  readonly createdAt: string;
  readonly toolVersion: string;
}

export interface ReportDiff {
  readonly schemaVersion: typeof DIFF_SCHEMA_VERSION;
  readonly tool: { readonly name: 'usertax'; readonly version: string };
  readonly base: ReportRef | null;
  readonly head: ReportRef;
  readonly settings: Report['settings'];
  readonly apps: readonly AppDiff[];
  /** Conditions that make the comparison less reliable, in plain English. */
  readonly warnings: readonly string[];
}

function refOf(report: Report): ReportRef {
  return {
    ...(report.git?.sha === undefined ? {} : { sha: report.git.sha }),
    ...(report.git?.ref === undefined ? {} : { ref: report.git.ref }),
    createdAt: report.createdAt,
    toolVersion: report.tool.version,
  };
}

function changeOf(base: number | undefined, head: number | undefined): Change {
  if (base === undefined) return 'added';
  if (head === undefined) return 'removed';
  if (head > base) return 'increased';
  if (head < base) return 'decreased';
  return 'unchanged';
}

function verdictOf(
  change: Change,
  significance: Significance,
  direction: MetricDirection,
): Verdict {
  if (significance === 'not-comparable') return 'unknown';
  if (change === 'unchanged' || significance === 'within-noise') return 'neutral';
  if (significance === 'unassessed') return 'unknown';
  const increased = change === 'increased';
  return increased === (direction === 'higher-is-better') ? 'better' : 'worse';
}

function diffMetric(
  base: Metric | undefined,
  head: Metric | undefined,
  noise: NoiseThresholds,
): MetricDiff {
  const metric = (head ?? base) as Metric;
  const change = changeOf(base?.value, head?.value);
  const common = {
    id: metric.id,
    group: metric.group,
    label: metric.label,
    unit: metric.unit,
    direction: metric.direction,
    ...(metric.compression === undefined ? {} : { compression: metric.compression }),
    ...(base === undefined ? {} : { base: base.value }),
    ...(head === undefined ? {} : { head: head.value }),
  };
  const spread = {
    ...(base?.samples === undefined ? {} : { base: summarize(base.samples) }),
    ...(head?.samples === undefined ? {} : { head: summarize(head.samples) }),
  };
  const withSpread = Object.keys(spread).length > 0 ? { spread } : {};

  if (base === undefined || head === undefined) {
    return {
      ...common,
      ...withSpread,
      change,
      significance: 'not-comparable',
      verdict: 'unknown',
    };
  }

  const delta = head.value - base.value;
  const percent = base.value === 0 ? undefined : (delta / Math.abs(base.value)) * 100;
  let significance: Significance = 'exact';
  let threshold: number | undefined;
  if (spread.base !== undefined && spread.head !== undefined) {
    const parameters =
      metric.noiseKey === undefined ? undefined : (noise[metric.noiseKey] ?? undefined);
    if (parameters === undefined) {
      significance = 'unassessed';
    } else {
      const pooledIqr = (spread.base.iqr + spread.head.iqr) / 2;
      threshold = Math.max(parameters.floor, parameters.k * pooledIqr);
      significance = Math.abs(delta) > threshold ? 'significant' : 'within-noise';
    }
  }
  return {
    ...common,
    ...withSpread,
    delta,
    ...(percent === undefined ? {} : { percent }),
    change,
    significance,
    verdict: verdictOf(change, significance, metric.direction),
    ...(threshold === undefined ? {} : { threshold }),
  };
}

function diffMetrics(base: App | undefined, head: App | undefined, noise: NoiseThresholds) {
  const baseMetrics = new Map((base ? extractMetrics(base) : []).map((m) => [m.id, m]));
  const headMetrics = head ? extractMetrics(head) : [];
  const result = headMetrics.map((metric) => diffMetric(baseMetrics.get(metric.id), metric, noise));
  const headIds = new Set(headMetrics.map((m) => m.id));
  for (const [id, metric] of baseMetrics) {
    if (!headIds.has(id)) result.push(diffMetric(metric, undefined, noise));
  }
  return result;
}

function sizeOf(asset: Asset): SizeDelta {
  return {
    raw: asset.raw,
    ...(asset.gzip === undefined ? {} : { gzip: asset.gzip }),
    ...(asset.brotli === undefined ? {} : { brotli: asset.brotli }),
  };
}

function subtract(head: SizeDelta | undefined, base: SizeDelta | undefined): SizeDelta {
  const pick = (key: 'gzip' | 'brotli') => {
    const h = head === undefined ? 0 : head[key];
    const b = base === undefined ? 0 : base[key];
    return h === undefined || b === undefined ? undefined : h - b;
  };
  const gzip = pick('gzip');
  const brotli = pick('brotli');
  return {
    raw: (head?.raw ?? 0) - (base?.raw ?? 0),
    ...(gzip === undefined ? {} : { gzip }),
    ...(brotli === undefined ? {} : { brotli }),
  };
}

function rankValue(delta: SizeDelta, rankBy: Compression): number {
  return Math.abs(delta[rankBy] ?? delta.raw);
}

function top<T>(
  items: T[],
  limit: number,
  score: (item: T) => number,
): { list: T[]; omitted: number } {
  const changed = items.filter((item) => score(item) !== 0);
  changed.sort((a, b) => score(b) - score(a));
  return { list: changed.slice(0, limit), omitted: Math.max(0, changed.length - limit) };
}

function diffAssets(
  base: App | undefined,
  head: App | undefined,
  limit: number,
  rankBy: Compression,
) {
  const baseAssets = new Map((base?.assets ?? []).map((a) => [a.key, a]));
  const headAssets = new Map((head?.assets ?? []).map((a) => [a.key, a]));
  const keys = new Set([...baseAssets.keys(), ...headAssets.keys()]);
  const diffs: AssetDiff[] = [];
  for (const key of keys) {
    const b = baseAssets.get(key);
    const h = headAssets.get(key);
    const asset = (h ?? b) as Asset;
    const bSize = b === undefined ? undefined : sizeOf(b);
    const hSize = h === undefined ? undefined : sizeOf(h);
    diffs.push({
      key,
      type: asset.type,
      change: changeOf(bSize?.raw, hSize?.raw),
      ...(b === undefined || bSize === undefined ? {} : { baseFile: b.file, base: bSize }),
      ...(h === undefined || hSize === undefined ? {} : { headFile: h.file, head: hSize }),
      delta: subtract(hSize, bSize),
    });
  }
  return top(diffs, limit, (d) => rankValue(d.delta, rankBy));
}

type PackageTotals = Map<string, Map<string | null, number>>;

function packageTotals(app: App | undefined): PackageTotals {
  const totals: PackageTotals = new Map();
  const add = (scope: string, name: string | null, bytes: number) => {
    let byName = totals.get(scope);
    if (!byName) {
      byName = new Map();
      totals.set(scope, byName);
    }
    byName.set(name, (byName.get(name) ?? 0) + bytes);
  };
  const sources = [
    ...(app?.assets ?? []).filter((a) => a.type === 'js').map((a) => ({ scope: 'web', item: a })),
    ...(app?.bundles ?? []).map((b) => ({ scope: b.platform, item: b })),
  ];
  for (const { scope, item } of sources) {
    for (const pkg of item.packages ?? []) add(scope, pkg.name, pkg.bytes);
    if (item.firstPartyBytes !== undefined) add(scope, null, item.firstPartyBytes);
  }
  return totals;
}

function diffPackages(base: App | undefined, head: App | undefined, limit: number) {
  const baseTotals = packageTotals(base);
  const headTotals = packageTotals(head);
  const diffs: PackageDiff[] = [];
  for (const scope of new Set([...baseTotals.keys(), ...headTotals.keys()])) {
    const b = baseTotals.get(scope) ?? new Map<string | null, number>();
    const h = headTotals.get(scope) ?? new Map<string | null, number>();
    for (const name of new Set([...b.keys(), ...h.keys()])) {
      const baseBytes = b.get(name);
      const headBytes = h.get(name);
      diffs.push({
        scope: scope as PackageDiff['scope'],
        name,
        base: baseBytes ?? 0,
        head: headBytes ?? 0,
        delta: (headBytes ?? 0) - (baseBytes ?? 0),
        change: changeOf(baseBytes, headBytes),
      });
    }
  }
  return top(diffs, limit, (d) => Math.abs(d.delta));
}

function diffArchiveEntries(base: App | undefined, head: App | undefined, limit: number) {
  const index = (archives: readonly Archive[] | undefined) =>
    new Map(
      (archives ?? []).map((a) => [a.key, new Map(a.entries.map((e) => [e.path, e]))] as const),
    );
  const baseArchives = index(base?.archives);
  const headArchives = index(head?.archives);
  const diffs: ArchiveEntryDiff[] = [];
  for (const key of headArchives.keys()) {
    const b = baseArchives.get(key);
    if (b === undefined) continue; // Without a base archive, every entry would be "added".
    const h = headArchives.get(key) ?? new Map<string, ArchiveEntry>();
    for (const path of new Set([...b.keys(), ...h.keys()])) {
      const be = b.get(path);
      const he = h.get(path);
      const entry = he ?? be;
      if (entry === undefined) continue;
      diffs.push({
        archive: key,
        path,
        category: entry.category,
        change: changeOf(be?.compressed, he?.compressed),
        base: be?.compressed ?? 0,
        head: he?.compressed ?? 0,
        delta: (he?.compressed ?? 0) - (be?.compressed ?? 0),
      });
    }
  }
  return top(diffs, limit, (d) => Math.abs(d.delta));
}

const DEPENDENCY_LIMIT = 50;

function explain(
  packages: PackageDiff[],
  base: App | undefined,
  head: App | undefined,
): { packages: PackageDiff[]; dependencies: DependencyChange[] } {
  const known = base?.dependencies !== undefined && head?.dependencies !== undefined;
  const changes = known ? diffDependencies(base.dependencies, head.dependencies) : [];
  const byName = new Map(changes.map((c) => [c.name, c]));
  const explainedNames = new Set<string>();
  const result = packages.map((pkg) => {
    if (pkg.name === null) return pkg;
    const cause: PackageCause | undefined = known
      ? (byName.get(pkg.name) ?? { kind: 'no-version-change' })
      : undefined;
    if (cause !== undefined && cause.kind !== 'no-version-change') explainedNames.add(pkg.name);
    const grew = pkg.change === 'added' || pkg.change === 'increased';
    const alternatives = grew ? alternativesFor(pkg.name) : undefined;
    return {
      ...pkg,
      ...(cause === undefined ? {} : { cause }),
      ...(alternatives === undefined ? {} : { alternatives }),
    };
  });
  return { packages: result, dependencies: changes.filter((c) => !explainedNames.has(c.name)) };
}

function warningsFor(base: Report, head: Report): string[] {
  const warnings: string[] = [];
  const bc = base.settings.compression;
  const hc = head.settings.compression;
  if (bc.gzipLevel !== hc.gzipLevel || bc.brotliQuality !== hc.brotliQuality) {
    warnings.push(
      `Compression settings differ between base (gzip ${bc.gzipLevel}, brotli ${bc.brotliQuality}) and head (gzip ${hc.gzipLevel}, brotli ${hc.brotliQuality}); compressed sizes are not directly comparable.`,
    );
  }
  const major = (version: string) => version.split('.')[0];
  if (major(base.tool.version) !== major(head.tool.version)) {
    warnings.push(
      `Base was measured with usertax ${base.tool.version} and head with ${head.tool.version}.`,
    );
  }
  const lighthouseVersions = (report: Report) =>
    new Set(report.apps.flatMap((a) => (a.lighthouse ?? []).map((l) => l.lighthouseVersion)));
  const bl = [...lighthouseVersions(base)].sort().join(', ');
  const hl = [...lighthouseVersions(head)].sort().join(', ');
  if (bl !== '' && hl !== '' && bl !== hl) {
    warnings.push(`Lighthouse versions differ between base (${bl}) and head (${hl}).`);
  }
  return warnings;
}

function diffApp(
  base: App | undefined,
  head: App | undefined,
  hasBase: boolean,
  options: Required<Pick<DiffOptions, 'top' | 'rankBy'>> & { noise: NoiseThresholds },
): AppDiff {
  const app = (head ?? base) as App;
  const assets = diffAssets(base, head, options.top, options.rankBy);
  const packages = diffPackages(base, head, options.top);
  const archiveEntries = diffArchiveEntries(base, head, options.top);
  const explained = explain(packages.list, base, head);
  let status: AppDiff['status'] = 'compared';
  if (!hasBase) status = 'head-only';
  else if (base === undefined) status = 'added';
  else if (head === undefined) status = 'removed';
  return {
    id: app.id,
    ...(base !== undefined && head !== undefined && base.id !== head.id
      ? { previousId: base.id }
      : {}),
    name: app.name,
    path: app.path,
    kind: app.kind,
    framework: app.framework,
    status,
    metrics: diffMetrics(base, head, options.noise),
    assets: hasBase ? assets.list : [],
    packages: hasBase ? explained.packages : [],
    archiveEntries: archiveEntries.list,
    dependencies: hasBase ? explained.dependencies.slice(0, DEPENDENCY_LIMIT) : [],
    omitted: {
      assets: hasBase ? assets.omitted : 0,
      packages: hasBase ? packages.omitted : 0,
      archiveEntries: archiveEntries.omitted,
      dependencies: hasBase ? Math.max(0, explained.dependencies.length - DEPENDENCY_LIMIT) : 0,
    },
  };
}

/**
 * Pairs head apps with base apps by id. An app whose id changed (for example after adding `id`
 * to the configuration) is paired by its path when exactly one unpaired app of the same kind has
 * that path on each side.
 */
function pairApps(head: readonly App[], base: readonly App[]): Map<App, App> {
  const byId = new Map(base.map((app) => [app.id, app]));
  const pairs = new Map<App, App>();
  for (const app of head) {
    const match = byId.get(app.id);
    if (match !== undefined) pairs.set(app, match);
  }
  const paired = new Set(pairs.values());
  const key = (app: App) => `${app.kind}\u0000${app.path}`;
  const group = (apps: readonly App[]) => {
    const groups = new Map<string, App[]>();
    for (const app of apps) groups.set(key(app), [...(groups.get(key(app)) ?? []), app]);
    return groups;
  };
  const headLeft = group(head.filter((app) => !pairs.has(app)));
  const baseLeft = group(base.filter((app) => !paired.has(app)));
  for (const [path, apps] of headLeft) {
    const candidates = baseLeft.get(path);
    if (apps.length === 1 && candidates?.length === 1) {
      pairs.set(apps[0] as App, candidates[0] as App);
    }
  }
  return pairs;
}

/**
 * Compares a head report with a base report. Without a base, the diff lists the head values
 * only (`status: 'head-only'`). Both reports must already be validated.
 */
export function diffReports(head: Report, base?: Report, options: DiffOptions = {}): ReportDiff {
  const resolved = {
    top: options.top ?? 10,
    rankBy: options.rankBy ?? 'gzip',
    noise: { ...DEFAULT_NOISE_THRESHOLDS, ...options.noise },
  };
  const pairs = pairApps(head.apps, base?.apps ?? []);
  const apps = head.apps.map((app) => diffApp(pairs.get(app), app, base !== undefined, resolved));
  const paired = new Set(pairs.values());
  for (const app of base?.apps ?? []) {
    if (!paired.has(app)) apps.push(diffApp(app, undefined, true, resolved));
  }
  return {
    schemaVersion: DIFF_SCHEMA_VERSION,
    tool: { name: 'usertax', version: head.tool.version },
    base: base === undefined ? null : refOf(base),
    head: refOf(head),
    settings: head.settings,
    apps,
    warnings: base === undefined ? [] : warningsFor(base, head),
  };
}
