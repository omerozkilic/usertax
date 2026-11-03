export { ALTERNATIVES_SOURCE, alternativesFor } from './alternatives.js';
export type { Alternatives } from './alternatives.js';
export { budgetSchema, evaluateBudgets } from './budgets.js';
export {
  ConfigError,
  appConfigSchema,
  configJsonSchema,
  configSchema,
  parseConfig,
} from './config.js';
export type { AppConfig, Config, ConfigInput } from './config.js';
export type {
  Budget,
  BudgetEvaluation,
  BudgetInput,
  BudgetResult,
  BudgetStatus,
} from './budgets.js';
export { compareVersions, diffDependencies } from './dependencies.js';
export type { DependencyChange, DependencyChangeKind } from './dependencies.js';
export { DIFF_SCHEMA_VERSION, diffReports } from './diff.js';
export type {
  AppDiff,
  ArchiveEntryDiff,
  AssetDiff,
  Change,
  DiffOptions,
  MetricDiff,
  NoiseThreshold,
  NoiseThresholds,
  PackageCause,
  PackageDiff,
  ReportDiff,
  ReportRef,
  Significance,
  SizeDelta,
  Verdict,
} from './diff.js';
export { formatByteDelta, formatBytes, formatPercentChange } from './format.js';
export type { FormatBytesOptions } from './format.js';
export { globToRegExp, matchesGlob } from './glob.js';
export { extractMetrics } from './metrics.js';
export type {
  LighthouseMetricName,
  Metric,
  MetricDirection,
  MetricGroup,
  MetricUnit,
} from './metrics.js';
export { parsePercent, parseQuantity } from './quantity.js';
export { escapeText, inlineCode } from './render/escape.js';
export { renderJson } from './render/json.js';
export {
  COMMENT_MARKER,
  DEFAULT_MAX_LENGTH,
  causeText,
  formatValue,
  renderMarkdown,
} from './render/markdown.js';
export type { RenderOptions } from './render/markdown.js';
export {
  REPORT_SCHEMA_VERSION,
  ReportValidationError,
  appSchema,
  archiveSchema,
  compressionSchema,
  frameworkSchema,
  platformSchema,
  assetSchema,
  jsBundleSchema,
  lighthouseSchema,
  parseReport,
  reportJsonSchema,
  reportSchema,
} from './schema.js';
export type {
  App,
  Archive,
  ArchiveCategory,
  Asset,
  AssetType,
  Compression,
  Dependency,
  Framework,
  JsBundle,
  Lighthouse,
  LighthouseRun,
  Platform,
  Report,
  Route,
} from './schema.js';
export { quantile, summarize } from './stats.js';
export type { SampleSummary } from './stats.js';
