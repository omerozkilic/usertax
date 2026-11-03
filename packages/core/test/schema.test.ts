import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReportValidationError, parseReport, reportJsonSchema } from '@usertax/core';
import { mobileApp, report, webApp } from './fixtures.js';

describe('parseReport', () => {
  it('accepts a valid report', () => {
    const input = report([webApp(), mobileApp()]);
    expect(parseReport(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  it('strips unknown keys so additive fields stay compatible', () => {
    const input = { ...report([webApp()]), futureField: { x: 1 } };
    expect(parseReport(input)).not.toHaveProperty('futureField');
  });

  it('rejects a report from a newer schema version with an actionable message', () => {
    expect(() => parseReport({ ...report([]), schemaVersion: 2 })).toThrow(/upgrade usertax/);
  });

  it('lists readable issues', () => {
    const bad = report([webApp({ id: 'bad id!' })]);
    try {
      parseReport(bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ReportValidationError);
      const issues = (error as ReportValidationError).issues;
      expect(issues[0]).toMatch(/^apps\.0\.id: /);
    }
  });

  it('rejects duplicate app ids', () => {
    expect(() => parseReport(report([webApp(), webApp()]))).toThrow(/duplicate app id "web"/);
  });

  it('rejects abbreviated SHAs and negative sizes', () => {
    expect(() => parseReport(report([], { git: { sha: 'abc1234' } }))).toThrow(
      /expected a full commit SHA/,
    );
    const negative = webApp();
    const firstAsset = negative.assets?.[0];
    if (firstAsset) firstAsset.raw = -1;
    expect(() => parseReport(report([negative]))).toThrow(ReportValidationError);
  });

  it('rejects input that is not a report', () => {
    expect(() => parseReport(null)).toThrow(/\(root\)/);
    expect(() => parseReport('{}')).toThrow(ReportValidationError);
  });

  it('caps the number of reported issues', () => {
    const apps = Array.from({ length: 30 }, (_, i) => webApp({ id: `app ${i}` }));
    try {
      parseReport(report(apps));
      expect.unreachable();
    } catch (error) {
      const issues = (error as ReportValidationError).issues;
      expect(issues).toHaveLength(21);
      expect(issues.at(-1)).toBe('…and 10 more');
    }
  });
});

describe('reportJsonSchema', () => {
  it('matches the committed schema file (run `pnpm --filter @usertax/core schema` to update)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../schema/report.v1.schema.json', import.meta.url), 'utf8'),
    );
    expect(reportJsonSchema()).toEqual(committed);
  });

  it('is a draft 2020-12 schema', () => {
    expect(reportJsonSchema()).toHaveProperty(
      '$schema',
      'https://json-schema.org/draft/2020-12/schema',
    );
  });
});
