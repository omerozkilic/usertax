import { describe, expect, it } from 'vitest';
import { formatByteDelta, formatBytes, formatPercentChange } from '@usertax/core';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 kB'],
    [207_400, '207.4 kB'],
    [1_500_000, '1.5 MB'],
    [2_000_000_000, '2.0 GB'],
    [5_000_000_000_000, '5000.0 GB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('carries rounding over to the next unit', () => {
    expect(formatBytes(999_960)).toBe('1.0 MB');
  });

  it('respects the decimals option', () => {
    expect(formatBytes(1_234_567, { decimals: 2 })).toBe('1.23 MB');
  });

  it('keeps the sign of negative values', () => {
    expect(formatBytes(-2048)).toBe('-2.0 kB');
  });

  it('rejects non-finite input', () => {
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
    expect(() => formatBytes(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatByteDelta', () => {
  it('adds an explicit sign', () => {
    expect(formatByteDelta(207_400)).toBe('+207.4 kB');
    expect(formatByteDelta(-1_200_000)).toBe('-1.2 MB');
  });

  it('renders zero as ±0 B', () => {
    expect(formatByteDelta(0)).toBe('±0 B');
  });

  it('rejects non-finite input', () => {
    expect(() => formatByteDelta(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatPercentChange', () => {
  it('computes signed relative change', () => {
    expect(formatPercentChange(1000, 1033)).toBe('+3.3%');
    expect(formatPercentChange(1000, 900)).toBe('-10.0%');
  });

  it('returns undefined when the base is zero', () => {
    expect(formatPercentChange(0, 100)).toBeUndefined();
  });

  it('treats changes that round to zero as no change', () => {
    expect(formatPercentChange(100_000, 100_001)).toBe('±0.0%');
    expect(formatPercentChange(100_000, 99_999, 2)).toBe('±0.00%');
  });

  it('rejects non-finite input', () => {
    expect(() => formatPercentChange(Number.NaN, 1)).toThrow(RangeError);
    expect(() => formatPercentChange(1, Number.NaN)).toThrow(RangeError);
  });
});
