import type { BudgetEvaluation, BudgetResult } from '../budgets.js';
import { ALTERNATIVES_SOURCE } from '../alternatives.js';
import type { AppDiff, MetricDiff, PackageCause, ReportDiff } from '../diff.js';
import { formatByteDelta, formatBytes } from '../format.js';
import type { MetricUnit } from '../metrics.js';
import type { Compression, Framework } from '../schema.js';
import { escapeText, inlineCode } from './escape.js';

/** Hidden marker that identifies the sticky comment. */
export const COMMENT_MARKER = '<!-- usertax:report -->';

/** GitHub rejects comments longer than 65 536 characters; keep a safety margin. */
export const DEFAULT_MAX_LENGTH = 60_000;

export interface RenderOptions {
  /** Which compressed size to show for web assets. Defaults to `gzip`. */
  readonly compression?: Compression;
  readonly budgets?: BudgetEvaluation;
  /** Prepend {@link COMMENT_MARKER}. Defaults to true. */
  readonly marker?: boolean;
  readonly maxLength?: number;
  /** Link to the workflow run, from the trusted environment, not from a report. */
  readonly runUrl?: string;
  /** Plain-text notes shown under the summary line (escaped like everything else). */
  readonly notes?: readonly string[];
}

const FRAMEWORK_LABEL: Record<Framework, string> = {
  vite: 'Vite',
  next: 'Next.js',
  astro: 'Astro',
  sveltekit: 'SvelteKit',
  webpack: 'webpack',
  expo: 'Expo',
  'react-native': 'React Native',
  static: 'Static site',
  other: 'Other',
};

const COMPRESSION_LABEL: Record<Compression, string> = {
  raw: 'raw',
  gzip: 'gzip',
  brotli: 'brotli',
};

function trimNumber(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
  });
}

export function formatValue(value: number, unit: MetricUnit | 'percent'): string {
  switch (unit) {
    case 'bytes':
      return formatBytes(value);
    case 'ms':
      return Math.abs(value) >= 1000
        ? `${trimNumber(value / 1000, 2)} s`
        : `${trimNumber(value, 0)} ms`;
    case 'score':
      return trimNumber(value, 1);
    case 'percent':
      return `${trimNumber(value, 1)}%`;
    case 'unitless':
      return trimNumber(value, 3);
  }
}

function formatDelta(value: number, unit: MetricUnit): string {
  if (unit === 'bytes') return formatByteDelta(value);
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : '-'}${formatValue(Math.abs(value), unit)}`;
}

function formatPercent(percent: number | undefined): string {
  if (percent === undefined) return '';
  const rounded = Number(percent.toFixed(1));
  if (rounded === 0) return ' (±0.0%)';
  return ` (${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%)`;
}

function shortSha(sha: string | undefined): string {
  return sha === undefined ? 'unknown' : inlineCode(sha.slice(0, 7), { table: false });
}

function icon(metric: MetricDiff): string {
  if (metric.change === 'added') return '🆕';
  if (metric.change === 'removed') return '➖';
  if (metric.contamination !== undefined) return '⚠️';
  if (metric.change === 'unchanged') return '⚪';
  if (metric.significance === 'within-noise') return '≈';
  switch (metric.verdict) {
    case 'better':
      return '🟢';
    case 'worse':
      return '🔴';
    case 'neutral':
      return '⚪';
    case 'unknown':
      return '❔';
  }
}

function withSpread(metric: MetricDiff, side: 'base' | 'head'): string {
  const value = metric[side];
  if (value === undefined) return '–';
  const spread = metric.spread?.[side];
  const text = formatValue(value, metric.unit);
  return spread === undefined
    ? text
    : `${text} <sub>IQR ${formatValue(spread.iqr, metric.unit)}, n=${spread.n}</sub>`;
}

function changeCell(metric: MetricDiff): string {
  if (metric.change === 'added') return 'new';
  if (metric.change === 'removed') return 'removed';
  if (metric.delta === undefined) return '–';
  const text = `${formatDelta(metric.delta, metric.unit)}${formatPercent(metric.percent)}`;
  if (metric.contamination !== undefined) return `${text} <sub>not comparable</sub>`;
  if (metric.delta === 0) return text;
  if (metric.significance === 'within-noise') return `${text} <sub>within noise</sub>`;
  if (metric.significance === 'unassessed') return `${text} <sub>noise not assessed</sub>`;
  return text;
}

function visibleMetric(metric: MetricDiff, compression: Compression): boolean {
  if (metric.compression === undefined) return true;
  // Mobile JS bundles ship inside the app archive: their raw size is what matters.
  if (metric.group === 'bundle') return metric.compression === 'raw';
  return metric.compression === compression;
}

function metricLabel(metric: MetricDiff): string {
  const suffix =
    metric.compression !== undefined && metric.group !== 'bundle'
      ? ` (${COMPRESSION_LABEL[metric.compression]})`
      : '';
  return `${escapeText(metric.label)}${suffix}`;
}

function metricsTable(metrics: readonly MetricDiff[], headOnly: boolean): string {
  if (headOnly) {
    const rows = metrics.map((m) => `| ${metricLabel(m)} | ${withSpread(m, 'head')} |`);
    return ['| Metric | Head |', '| --- | --: |', ...rows].join('\n');
  }
  const rows = metrics.map(
    (m) =>
      `| ${icon(m)} | ${metricLabel(m)} | ${withSpread(m, 'base')} | ${withSpread(m, 'head')} | ${changeCell(m)} |`,
  );
  return ['| | Metric | Base | Head | Change |', '| :-: | --- | --: | --: | --: |', ...rows].join(
    '\n',
  );
}

function moreLine(count: number, singular: string, plural: string): string {
  return count > 0 ? `\n\n…and ${count} more changed ${count === 1 ? singular : plural}.` : '';
}

function details(summary: string, body: string): string {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

function sizeCell(value: number | undefined): string {
  return value === undefined ? '–' : formatBytes(value);
}

function assetsBlock(app: AppDiff, compression: Compression): string | undefined {
  if (app.assets.length === 0) return undefined;
  const pick = (size: { raw: number; gzip?: number; brotli?: number } | undefined) =>
    size === undefined ? undefined : (size[compression] ?? size.raw);
  const rows = app.assets.map((asset) => {
    const file = asset.headFile ?? asset.baseFile ?? asset.key;
    const delta = asset.delta[compression] ?? asset.delta.raw;
    return `| ${inlineCode(file)} | ${sizeCell(pick(asset.base))} | ${sizeCell(pick(asset.head))} | ${formatByteDelta(delta)} |`;
  });
  const more = moreLine(app.omitted.assets, 'file', 'files');
  return details(
    `Files with the largest change (${COMPRESSION_LABEL[compression]})`,
    ['| File | Base | Head | Change |', '| --- | --: | --: | --: |', ...rows].join('\n') + more,
  );
}

const SCOPE_LABEL = { web: 'web', ios: 'iOS', android: 'Android' } as const;

function versionList(versions: readonly string[]): string {
  return versions.map((v) => inlineCode(v)).join(', ');
}

function viaText(via: readonly string[] | undefined): string {
  return via === undefined || via.length === 0
    ? ''
    : ` via ${via.map((v) => inlineCode(v)).join(', ')}`;
}

/** Plain-English reason for a package change, from the lockfile diff. */
export function causeText(cause: PackageCause | undefined): string {
  if (cause === undefined) return '–';
  switch (cause.kind) {
    case 'no-version-change':
      return 'same version; more or less of it is imported';
    case 'added':
      return `added ${versionList(cause.head)}${cause.direct ? ' (direct)' : viaText(cause.via)}`;
    case 'removed':
      return `removed ${versionList(cause.base)}${cause.direct ? ' (direct)' : viaText(cause.via)}`;
    case 'upgraded':
    case 'downgraded':
      return `${cause.kind} ${versionList(cause.base)} → ${versionList(cause.head)}${cause.direct ? '' : viaText(cause.via)}`;
    case 'changed':
      return `versions ${versionList(cause.base)} → ${versionList(cause.head)}${cause.direct ? '' : viaText(cause.via)}`;
  }
}

function safeUrl(url: string): string | undefined {
  return /^https:\/\/[^\s<>()]+$/.test(url) ? url : undefined;
}

function packagesBlock(app: AppDiff): string | undefined {
  if (app.packages.length === 0) return undefined;
  const withCause = app.packages.some((pkg) => pkg.cause !== undefined);
  const rows = app.packages.map((pkg) => {
    const name = pkg.name === null ? '_first-party code_' : inlineCode(pkg.name);
    const baseCell = pkg.change === 'added' ? '–' : sizeCell(pkg.base);
    const headCell = pkg.change === 'removed' ? '–' : sizeCell(pkg.head);
    const why = withCause ? ` ${pkg.name === null ? '–' : causeText(pkg.cause)} |` : '';
    return `| ${name} | ${SCOPE_LABEL[pkg.scope]} | ${baseCell} | ${headCell} | ${formatByteDelta(pkg.delta)} |${why}`;
  });
  const header = withCause
    ? ['| Package | Bundle | Base | Head | Change | Why |', '| --- | --- | --: | --: | --: | --- |']
    : ['| Package | Bundle | Base | Head | Change |', '| --- | --- | --: | --: | --: |'];
  // A package can appear once per bundle (Android and iOS); suggest its alternatives once.
  const suggested = new Set<string>();
  const suggestions = app.packages.flatMap((pkg) => {
    if (pkg.name === null || pkg.alternatives === undefined || suggested.has(pkg.name)) return [];
    suggested.add(pkg.name);
    const url = safeUrl(pkg.alternatives.url);
    const link = url === undefined ? '' : ` ([guide](${url}))`;
    return [
      `- ${inlineCode(pkg.name, { table: false })}: ${pkg.alternatives.replacements.map((r) => escapeText(r)).join(', ')}${link}`,
    ];
  });
  const alternatives =
    suggestions.length > 0
      ? `\n\n**Alternatives** suggested by [e18e module-replacements](${ALTERNATIVES_SOURCE.url}) ${escapeText(ALTERNATIVES_SOURCE.version, 20)}:\n\n${suggestions.join('\n')}`
      : '';
  return [
    '**Packages with the largest change** <sub>minified bytes from source maps</sub>',
    '',
    [...header, ...rows].join('\n') +
      moreLine(app.omitted.packages, 'package', 'packages') +
      alternatives,
  ].join('\n');
}

function duplicatesBlock(app: AppDiff): string | undefined {
  if (app.duplicates.length === 0) return undefined;
  const withStatus = app.duplicates.some((dup) => dup.introduced !== undefined);
  const rows = app.duplicates.map((dup) => {
    const versions = dup.versions
      .map(
        (v) =>
          `${inlineCode(v.version)} ${formatBytes(v.bytes)}${v.direct === true ? ' (direct)' : viaText(v.via)}`,
      )
      .join(' · ');
    const status = withStatus ? ` ${dup.introduced === true ? '**new**' : 'existing'} |` : '';
    return `| ${inlineCode(dup.name)} | ${SCOPE_LABEL[dup.scope]} | ${versions} | ${formatBytes(dup.bytes)} |${status}`;
  });
  const table =
    [
      withStatus
        ? '| Package | Bundle | Versions | Total | |'
        : '| Package | Bundle | Versions | Total |',
      withStatus ? '| --- | --- | --- | --: | --- |' : '| --- | --- | --- | --: |',
      ...rows,
    ].join('\n') + moreDuplicates(app.omitted.duplicates);
  const introduced = app.duplicates.filter((dup) => dup.introduced === true).length;
  if (withStatus && introduced === 0) {
    const total = app.duplicates.length + app.omitted.duplicates;
    return details(
      `${total} duplicate ${total === 1 ? 'package' : 'packages'} already in the base`,
      table,
    );
  }
  return [
    '**Duplicate packages** <sub>the same package bundled in more than one version</sub>',
    '',
    table,
  ].join('\n');
}

function moreDuplicates(count: number): string {
  return count > 0
    ? `\n\n…and ${count} more duplicate ${count === 1 ? 'package' : 'packages'}.`
    : '';
}

function dependenciesBlock(app: AppDiff): string | undefined {
  if (app.dependencies.length === 0) return undefined;
  const rows = app.dependencies.map(
    (dep) => `| ${inlineCode(dep.name)} | ${causeText(dep)}${dep.dev ? ' <sub>dev</sub>' : ''} |`,
  );
  const total = app.dependencies.length + app.omitted.dependencies;
  return details(
    `${total} lockfile ${total === 1 ? 'change' : 'changes'} without a bundle size change`,
    ['| Package | Change |', '| --- | --- |', ...rows].join('\n') +
      moreLine(app.omitted.dependencies, 'dependency', 'dependencies'),
  );
}

function archiveEntriesBlock(app: AppDiff): string | undefined {
  if (app.archiveEntries.length === 0) return undefined;
  const rows = app.archiveEntries.map((entry) => {
    const baseCell = entry.change === 'added' ? '–' : sizeCell(entry.base);
    const headCell = entry.change === 'removed' ? '–' : sizeCell(entry.head);
    return `| ${inlineCode(entry.path)} | ${inlineCode(entry.archive)} | ${entry.category} | ${baseCell} | ${headCell} | ${formatByteDelta(entry.delta)} |`;
  });
  const more = moreLine(app.omitted.archiveEntries, 'entry', 'entries');
  return details(
    'Archive entries with the largest change (compressed)',
    [
      '| Entry | Archive | Category | Base | Head | Change |',
      '| --- | --- | --- | --: | --: | --: |',
      ...rows,
    ].join('\n') + more,
  );
}

interface Block {
  readonly text: string;
  /** Optional blocks are dropped first when the comment is too long. */
  readonly optional: boolean;
}

function appBlocks(app: AppDiff, headOnly: boolean, compression: Compression): Block[] {
  const status =
    app.status === 'added'
      ? ' · new app'
      : app.status === 'removed'
        ? ' · removed'
        : app.previousId === undefined
          ? ''
          : ` · id was ${inlineCode(app.previousId, { table: false })}`;
  const heading = `### ${escapeText(app.name)} <sub>${FRAMEWORK_LABEL[app.framework]} · ${inlineCode(app.path, { table: false })}${status}</sub>`;
  const visible = app.metrics.filter((m) => visibleMetric(m, compression));
  const changed = visible.filter((m) => m.change !== 'unchanged');
  const unchanged = visible.filter((m) => m.change === 'unchanged');
  const blocks: Block[] = [{ text: heading, optional: false }];
  if (visible.length === 0) {
    blocks.push({ text: '_Nothing was measured for this app._', optional: false });
    return blocks;
  }
  if (headOnly) {
    blocks.push({ text: metricsTable(visible, true), optional: false });
    return blocks;
  }
  blocks.push({
    text: changed.length > 0 ? metricsTable(changed, false) : '_No changes._',
    optional: false,
  });
  if (unchanged.length > 0) {
    blocks.push({
      text: details(`${unchanged.length} unchanged`, metricsTable(unchanged, false)),
      optional: true,
    });
  }
  for (const block of [
    packagesBlock(app),
    duplicatesBlock(app),
    assetsBlock(app, compression),
    archiveEntriesBlock(app),
    dependenciesBlock(app),
  ]) {
    if (block !== undefined) blocks.push({ text: block, optional: true });
  }
  return blocks;
}

const BUDGET_ICON = { pass: '✅', warn: '⚠️', fail: '❌', skipped: '⏭️' } as const;

function budgetValue(result: BudgetResult, value: number): string {
  if (result.unit === 'percent') return formatValue(value, 'percent');
  if (result.limit === 'max' || result.limit === 'min') return formatValue(value, result.unit);
  return formatDelta(value, result.unit);
}

function budgetsBlock(evaluation: BudgetEvaluation): string | undefined {
  if (evaluation.results.length === 0 && evaluation.unmatched.length === 0) return undefined;
  const rows = evaluation.results.map(
    (r) =>
      `| ${BUDGET_ICON[r.status]} | ${inlineCode(r.appId)} | ${escapeText(r.label)} | ${r.limit} ${budgetValue(r, r.threshold)} | ${r.actual === undefined ? '–' : budgetValue(r, r.actual)} | ${escapeText(r.message)} |`,
  );
  const lines = ['### Budgets'];
  if (rows.length > 0) {
    lines.push(
      '',
      '| | App | Metric | Limit | Actual | Result |',
      '| :-: | --- | --- | --- | --: | --- |',
      ...rows,
    );
  }
  if (evaluation.unmatched.length > 0) {
    const patterns = evaluation.unmatched
      .map(
        (b) => `${inlineCode(b.app, { table: false })} / ${inlineCode(b.metric, { table: false })}`,
      )
      .join(', ');
    lines.push('', `Budgets that matched no metric: ${patterns}`);
  }
  return lines.join('\n');
}

function summaryLine(diff: ReportDiff, evaluation: BudgetEvaluation | undefined): string {
  const parts: string[] = [];
  parts.push(
    diff.base === null
      ? `Head ${shortSha(diff.head.sha)} · no base report to compare with`
      : `Base ${shortSha(diff.base.sha)} → head ${shortSha(diff.head.sha)}`,
  );
  parts.push(`${diff.apps.length} ${diff.apps.length === 1 ? 'app' : 'apps'}`);
  if (evaluation !== undefined && evaluation.results.length > 0) {
    const count = (status: string) => evaluation.results.filter((r) => r.status === status).length;
    const failed = count('fail');
    const warned = count('warn');
    if (failed > 0) parts.push(`❌ ${failed} budget${failed === 1 ? '' : 's'} failed`);
    if (warned > 0) parts.push(`⚠️ ${warned} budget warning${warned === 1 ? '' : 's'}`);
    const skipped = count('skipped');
    if (failed === 0 && warned === 0) {
      // A budget that could not be checked is not a pass.
      if (skipped === 0) parts.push('✅ all budgets pass');
      else if (skipped === evaluation.results.length)
        parts.push(`⏭️ ${skipped} budget${skipped === 1 ? '' : 's'} skipped`);
      else parts.push(`✅ ${count('pass')} pass · ⏭️ ${skipped} skipped`);
    } else if (skipped > 0) {
      parts.push(`⏭️ ${skipped} skipped`);
    }
  }
  return parts.join(' · ');
}

function footer(diff: ReportDiff, runUrl: string | undefined): string {
  const { gzipLevel, brotliQuality } = diff.settings.compression;
  const parts = [
    `usertax ${escapeText(diff.tool.version, 50)}`,
    `gzip level ${gzipLevel}, brotli quality ${brotliQuality}`,
  ];

  if (runUrl !== undefined && /^https:\/\/[^\s<>()]+$/.test(runUrl)) {
    parts.push(`[workflow run](${runUrl})`);
  }
  return `<sub>${parts.join(' · ')}</sub>`;
}

function join(blocks: readonly Block[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

/** Renders a diff as a PR comment (with the sticky marker) or a job summary. */
export function renderMarkdown(diff: ReportDiff, options: RenderOptions = {}): string {
  const compression = options.compression ?? 'gzip';
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const headOnly = diff.base === null;

  const header: Block[] = [];
  if (options.marker ?? true) header.push({ text: COMMENT_MARKER, optional: false });
  header.push({ text: '## usertax report', optional: false });
  header.push({ text: summaryLine(diff, options.budgets), optional: false });
  if (options.notes !== undefined && options.notes.length > 0) {
    header.push({
      text: ['> [!NOTE]', ...options.notes.map((n) => `> ${escapeText(n, 500)}`)].join('\n'),
      optional: false,
    });
  }
  if (diff.warnings.length > 0) {
    header.push({
      text: ['> [!WARNING]', ...diff.warnings.map((w) => `> ${escapeText(w, 500)}`)].join('\n'),
      optional: false,
    });
  }
  const body: Block[] = diff.apps.flatMap((app) => appBlocks(app, headOnly, compression));
  const budgets = options.budgets === undefined ? undefined : budgetsBlock(options.budgets);
  const tail: Block[] = [
    ...(budgets === undefined ? [] : [{ text: budgets, optional: false }]),
    { text: footer(diff, options.runUrl), optional: false },
  ];

  let blocks = [...header, ...body, ...tail];
  let text = join(blocks);
  if (text.length <= maxLength) return text;

  // Drop collapsible details first, from the end.
  const notice: Block = {
    text: "> [!NOTE]\n> Some details were left out to fit GitHub's comment size limit. The job summary and the JSON report have everything.",
    optional: false,
  };
  const kept = [...body];
  const length = () => join([...header, notice, ...kept, ...tail]).length;
  for (let i = kept.length - 1; i >= 0 && length() > maxLength; i -= 1) {
    if (kept[i]?.optional === true) kept.splice(i, 1);
  }
  blocks = [...header, notice, ...kept, ...tail];
  text = join(blocks);
  if (text.length <= maxLength) return text;

  // Still too long: keep whole app sections while they fit.
  const fitted: Block[] = [];
  const omittedNotice = (n: number): Block => ({
    text: `_…and ${n} more ${n === 1 ? 'app' : 'apps'} not shown._`,
    optional: false,
  });
  for (const block of kept) {
    const candidate = [
      ...header,
      notice,
      ...fitted,
      block,
      omittedNotice(diff.apps.length),
      ...tail,
    ];
    if (join(candidate).length > maxLength) break;
    fitted.push(block);
  }
  const shownApps = fitted.filter((b) => b.text.startsWith('### ')).length;
  return join([...header, notice, ...fitted, omittedNotice(diff.apps.length - shownApps), ...tail]);
}
