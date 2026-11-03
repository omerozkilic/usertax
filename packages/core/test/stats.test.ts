import { describe, expect, it } from 'vitest';
import { quantile, summarize } from '@usertax/core';

describe('quantile', () => {
  it('interpolates linearly between ranks (R-7)', () => {
    const sorted = [1, 2, 3, 4];
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 0.25)).toBe(1.75);
    expect(quantile(sorted, 0.5)).toBe(2.5);
    expect(quantile(sorted, 1)).toBe(4);
  });

  it('handles a single sample', () => {
    expect(quantile([7], 0.5)).toBe(7);
  });

  it('rejects empty samples and out-of-range quantiles', () => {
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], -0.1)).toThrow(RangeError);
    expect(() => quantile([1], 1.1)).toThrow(RangeError);
  });
});

describe('summarize', () => {
  it('summarizes unsorted samples', () => {
    expect(summarize([90, 70, 80, 100, 60])).toEqual({
      n: 5,
      median: 80,
      q1: 70,
      q3: 90,
      iqr: 20,
      min: 60,
      max: 100,
    });
  });

  it('does not mutate the input', () => {
    const samples = [3, 1, 2];
    summarize(samples);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('rejects empty and non-finite samples', () => {
    expect(() => summarize([])).toThrow(RangeError);
    expect(() => summarize([1, Number.NaN])).toThrow(RangeError);
  });
});
