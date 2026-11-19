import { describe, expect, it } from 'vitest';
import {
  REPORT_LIMITS,
  ReportValidationError,
  findLimitViolation,
  parseReport,
  parseReportText,
} from '@usertax/core';
import { mobileApp, modify, report, webApp } from './fixtures.js';

const valid = report([webApp(), mobileApp()]);

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

function rejection(text: string): ReportValidationError {
  try {
    parseReportText(text);
  } catch (error) {
    if (error instanceof ReportValidationError) return error;
    throw error;
  }
  throw new Error('expected the report to be rejected');
}

describe('findLimitViolation', () => {
  it('accepts a valid report and values at the limits', () => {
    expect(findLimitViolation(valid)).toBeUndefined();
    expect(findLimitViolation(nested(REPORT_LIMITS.maxDepth - 1))).toBeUndefined();
    expect(findLimitViolation('x'.repeat(REPORT_LIMITS.maxStringLength))).toBeUndefined();
    expect(findLimitViolation(new Array(REPORT_LIMITS.maxArrayLength).fill(0))).toBeUndefined();
  });

  it('rejects documents nested too deeply, without overflowing the stack', () => {
    expect(findLimitViolation(nested(REPORT_LIMITS.maxDepth + 1))).toMatch(/nested deeper/);
    expect(findLimitViolation(nested(1_000_000))).toMatch(/nested deeper/);
    const object: Record<string, unknown> = {};
    let cursor = object;
    for (let i = 0; i < 100_000; i++) cursor = cursor['k'] = {};
    expect(findLimitViolation(object)).toMatch(/nested deeper/);
  });

  it.each([
    ['long strings', 'x'.repeat(REPORT_LIMITS.maxStringLength + 1), /string longer/],
    ['long keys', { ['k'.repeat(REPORT_LIMITS.maxStringLength + 1)]: 1 }, /key longer/],
    ['long arrays', new Array(REPORT_LIMITS.maxArrayLength + 1).fill(0), /array with more/],
    [
      'wide objects',
      Object.fromEntries(Array.from({ length: REPORT_LIMITS.maxObjectKeys + 1 }, (_, i) => [i, 0])),
      /object with more/,
    ],
  ])('rejects %s', (_name, value, message) => {
    expect(findLimitViolation(value)).toMatch(message);
  });

  it('rejects documents with too many values, with smaller limits', () => {
    const limits = { ...REPORT_LIMITS, maxNodes: 10 };
    expect(findLimitViolation(new Array(9).fill(0), limits)).toBeUndefined();
    expect(findLimitViolation(new Array(10).fill(0), limits)).toMatch(/more than 10 values/);
  });

  it('keeps the limits above what the schema allows, so a valid report never hits them', () => {
    // The longest string bounds in the schema are paths at 1024 characters.
    expect(REPORT_LIMITS.maxStringLength).toBeGreaterThanOrEqual(1024);
    // `dependencies` and archive `entries` hold up to 50 000 items.
    expect(REPORT_LIMITS.maxArrayLength).toBeGreaterThanOrEqual(50_000);
  });
});

describe('parseReportText', () => {
  it('parses a report', () => {
    expect(parseReportText(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects oversized text before parsing it', () => {
    const error = rejection(' '.repeat(REPORT_LIMITS.maxBytes + 1));
    expect(error.message).toMatch(/larger than 20000000/);
  });

  it('rejects text that is not JSON, truncated or empty with a message', () => {
    for (const text of ['', 'not json', '{"schemaVersion":1,', JSON.stringify(valid).slice(0, 100)])
      expect(rejection(text).message).toBe('report is not valid JSON');
  });

  it('rejects absurdly deep nesting, whatever the parser does with it', () => {
    const depth = 2_000_000;
    const error = rejection('['.repeat(depth) + ']'.repeat(depth));
    expect(error).toBeInstanceOf(ReportValidationError);
  });

  it('rejects hostile structure inside a valid report with the limit that was hit', () => {
    const hostile = modify(valid, (r) => {
      const app = r.apps[0];
      if (app) app.name = 'x'.repeat(5000);
    });
    expect(rejection(JSON.stringify(hostile)).message).toMatch(/string longer than 1024/);
    expect(() => parseReport({ ...valid, extra: nested(REPORT_LIMITS.maxDepth + 5) })).toThrow(
      /nested deeper/,
    );
  });

  it('rejects JSON values that are not objects', () => {
    for (const text of ['null', '1', '"report"', '[]', 'true'])
      expect(rejection(text)).toBeInstanceOf(ReportValidationError);
  });
});
