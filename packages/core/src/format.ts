/**
 * Byte and delta formatting used by every renderer.
 *
 * usertax uses SI units (1 kB = 1000 bytes), the same convention as Chrome DevTools'
 * network panel, so numbers in a PR comment can be compared with what a developer
 * sees in the browser.
 */

const UNITS = ['B', 'kB', 'MB', 'GB'] as const;

export interface FormatBytesOptions {
  /** Digits after the decimal point for values of 1 kB and above. Defaults to 1. */
  readonly decimals?: number;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received ${String(value)}`);
  }
}

/** Formats a byte count, e.g. `207400` → `"207.4 kB"`. Negative values keep their sign. */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  assertFiniteNumber(bytes, 'bytes');
  const decimals = options.decimals ?? 1;
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  // Rounding can push a value to the next unit (999.96 kB → "1000.0 kB"); carry it over.
  if (unitIndex > 0 && unitIndex < UNITS.length - 1 && Number(value.toFixed(decimals)) >= 1000) {
    value /= 1000;
    unitIndex += 1;
  }
  const unit = UNITS[unitIndex] ?? 'B';
  const text = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(decimals);
  return `${sign}${text} ${unit}`;
}

/** Formats a signed byte delta, e.g. `+207.4 kB`, `-1.2 MB`, `±0 B`. */
export function formatByteDelta(delta: number, options: FormatBytesOptions = {}): string {
  assertFiniteNumber(delta, 'delta');
  if (delta === 0) {
    return '±0 B';
  }
  const formatted = formatBytes(Math.abs(delta), options);
  return `${delta > 0 ? '+' : '-'}${formatted}`;
}

/**
 * Formats the relative change from `base` to `head` as a signed percentage, e.g. `+3.3%`.
 * Returns `undefined` when there is no meaningful base (zero), so callers can render "new".
 */
export function formatPercentChange(base: number, head: number, decimals = 1): string | undefined {
  assertFiniteNumber(base, 'base');
  assertFiniteNumber(head, 'head');
  if (base === 0) {
    return undefined;
  }
  const percent = ((head - base) / Math.abs(base)) * 100;
  const rounded = Number(percent.toFixed(decimals));
  if (rounded === 0) {
    return `±${(0).toFixed(decimals)}%`;
  }
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(decimals)}%`;
}
