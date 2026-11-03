import type { MetricUnit } from './metrics.js';

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
};

const TIME_UNITS: Record<string, number> = { ms: 1, s: 1000 };

const QUANTITY = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i;

/**
 * Parses a budget value for a metric unit. Numbers are taken as-is (bytes, milliseconds,
 * score points). Strings may carry a unit: `250kB`, `1.5 MB`, `100 KiB`, `200ms`, `2.5s`.
 * kB/MB/GB are SI (1000-based), KiB/MiB/GiB binary.
 */
export function parseQuantity(value: number | string, unit: MetricUnit): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`invalid budget value ${String(value)}`);
    return value;
  }
  const match = QUANTITY.exec(value);
  if (!match) throw new RangeError(`invalid budget value "${value}"`);
  const amount = Number(match[1]);
  const suffix = (match[2] ?? '').toLowerCase();
  if (suffix === '') return amount;
  const table = unit === 'bytes' ? BYTE_UNITS : unit === 'ms' ? TIME_UNITS : undefined;
  const factor = table?.[suffix];
  if (factor === undefined) {
    throw new RangeError(`unit "${match[2] ?? ''}" is not valid for a ${unit} metric ("${value}")`);
  }
  return amount * factor;
}

/** Parses a percentage such as `5`, `5%` or `"2.5 %"`. */
export function parsePercent(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`invalid percentage ${String(value)}`);
    return value;
  }
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
  if (!match) throw new RangeError(`invalid percentage "${value}"`);
  return Number(match[1]);
}
