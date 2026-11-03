/** Summary statistics of repeated measurements (ADR 0007). */
export interface SampleSummary {
  readonly n: number;
  readonly median: number;
  readonly q1: number;
  readonly q3: number;
  readonly iqr: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Quantile with linear interpolation between closest ranks (the R-7 / Excel `PERCENTILE.INC`
 * definition). `sorted` must be sorted ascending and non-empty.
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    throw new RangeError('quantile of an empty sample');
  }
  if (q < 0 || q > 1) {
    throw new RangeError(`quantile must be within [0, 1], received ${q}`);
  }
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return low + (high - low) * (position - lower);
}

export function summarize(samples: readonly number[]): SampleSummary {
  if (samples.length === 0) {
    throw new RangeError('cannot summarize an empty sample');
  }
  if (samples.some((value) => !Number.isFinite(value))) {
    throw new RangeError('samples must be finite numbers');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
  };
}
