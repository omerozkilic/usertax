import { describe, expect, it } from 'vitest';
import { parsePercent, parseQuantity } from '@usertax/core';

describe('parseQuantity', () => {
  it.each([
    [250_000, 'bytes', 250_000],
    ['250kB', 'bytes', 250_000],
    ['1.5 MB', 'bytes', 1_500_000],
    ['100 KiB', 'bytes', 102_400],
    ['2 GiB', 'bytes', 2 * 1024 ** 3],
    ['512', 'bytes', 512],
    ['200ms', 'ms', 200],
    ['2.5s', 'ms', 2500],
    ['90', 'score', 90],
    ['0.1', 'unitless', 0.1],
  ] as const)('parses %s for %s', (input, unit, expected) => {
    expect(parseQuantity(input, unit)).toBe(expected);
  });

  it('rejects units that do not fit the metric', () => {
    expect(() => parseQuantity('200ms', 'bytes')).toThrow(/not valid for a bytes metric/);
    expect(() => parseQuantity('10kB', 'ms')).toThrow(RangeError);
    expect(() => parseQuantity('10kB', 'score')).toThrow(RangeError);
  });

  it('rejects malformed values', () => {
    expect(() => parseQuantity('lots', 'bytes')).toThrow(/invalid budget value/);
    expect(() => parseQuantity(Number.NaN, 'bytes')).toThrow(RangeError);
  });
});

describe('parsePercent', () => {
  it('accepts numbers and strings with or without %', () => {
    expect(parsePercent(5)).toBe(5);
    expect(parsePercent('5%')).toBe(5);
    expect(parsePercent(' 2.5 % ')).toBe(2.5);
  });

  it('rejects malformed values', () => {
    expect(() => parsePercent('five')).toThrow(RangeError);
    expect(() => parsePercent(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
