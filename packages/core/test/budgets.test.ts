import type { NoiseThresholds } from '@usertax/core';
import { describe, expect, it } from 'vitest';
import { budgetSchema, diffReports, evaluateBudgets } from '@usertax/core';
import type { BudgetInput } from '@usertax/core';
import { lighthouseApp, mobileApp, modify, report, webApp } from './fixtures.js';

const base = report([webApp(), mobileApp()]);
const head = modify(base, (r) => {
  const asset = r.apps[0]?.assets?.[0];
  if (asset) asset.gzip = 40_000; // js.total.gzip 34 000 → 44 000 (+10 000, +29.4 %)
});
const diff = diffReports(head, base);

function evaluate(...budgets: BudgetInput[]) {
  return evaluateBudgets(
    diff,
    budgets.map((b) => budgetSchema.parse(b)),
  );
}

/** Turns the calibrated default noise thresholds off, to test unassessed changes. */
const OFF: NoiseThresholds = { performance: null, lcp: null, tbt: null, cls: null };

describe('budgetSchema', () => {
  it('applies defaults', () => {
    expect(budgetSchema.parse({ metric: 'js.total.gzip', max: '50kB' })).toEqual({
      app: '*',
      metric: 'js.total.gzip',
      max: '50kB',
      level: 'fail',
    });
  });

  it('requires at least one limit', () => {
    expect(() => budgetSchema.parse({ metric: 'js.total.gzip' })).toThrow(/at least one limit/);
  });
});

describe('evaluateBudgets', () => {
  it('passes when within an absolute limit', () => {
    const result = evaluate({ metric: 'js.total.gzip', max: '50kB' });
    expect(result.status).toBe('pass');
    expect(result.results).toEqual([
      {
        appId: 'web',
        metricId: 'js.total.gzip',
        label: 'JS total',
        status: 'pass',
        limit: 'max',
        threshold: 50_000,
        actual: 44_000,
        unit: 'bytes',
        message: 'max within limit',
      },
    ]);
  });

  it('fails or warns according to the level', () => {
    expect(evaluate({ metric: 'js.total.gzip', max: '40kB' }).status).toBe('fail');
    expect(evaluate({ metric: 'js.total.gzip', max: '40kB', level: 'warn' }).status).toBe('warn');
  });

  it('checks minimums', () => {
    expect(evaluate({ metric: 'js.total.gzip', min: '45kB' }).status).toBe('fail');
  });

  it('checks increases in bytes and percent', () => {
    expect(evaluate({ metric: 'js.total.gzip', maxIncrease: '5 kB' }).results[0]).toMatchObject({
      status: 'fail',
      actual: 10_000,
      message: 'maxIncrease exceeded',
    });
    expect(evaluate({ metric: 'js.total.gzip', maxIncreasePercent: '30%' }).status).toBe('pass');
    expect(evaluate({ metric: 'js.total.gzip', maxIncreasePercent: 20 }).results[0]).toMatchObject({
      status: 'fail',
      unit: 'percent',
    });
  });

  it('checks decreases', () => {
    expect(evaluate({ metric: 'js.total.gzip', maxDecrease: '1kB' }).status).toBe('pass');
    const shrunk = diffReports(base, head);
    const result = evaluateBudgets(shrunk, [
      budgetSchema.parse({ metric: 'js.total.gzip', maxDecreasePercent: 10 }),
    ]);
    expect(result.results[0]).toMatchObject({ status: 'fail' });
  });

  it('selects apps and metrics with globs', () => {
    const result = evaluate({ app: 'web', metric: 'route[*].js.gzip', max: '35kB' });
    expect(result.results.map((r) => [r.metricId, r.status])).toEqual([
      ['route[/].js.gzip', 'fail'],
      ['route[/about].js.gzip', 'fail'],
    ]);
    expect(evaluate({ app: 'mobile', metric: 'js.total.gzip', max: 1 }).unmatched).toHaveLength(1);
  });

  it('applies route CSS budgets to routes that load CSS', () => {
    const result = evaluate({ app: 'web', metric: 'route[*].css.gzip', max: '1kB' });
    expect(result.results.map((r) => [r.metricId, r.status])).toEqual([
      ['route[/].css.gzip', 'fail'],
    ]);
  });

  it('skips change limits without a base', () => {
    const headOnly = diffReports(head);
    const result = evaluateBudgets(headOnly, [
      budgetSchema.parse({ metric: 'js.total.gzip', max: '1MB', maxIncrease: '1kB' }),
    ]);
    expect(result.results.map((r) => [r.limit, r.status, r.message])).toEqual([
      ['max', 'pass', 'max within limit'],
      ['maxIncrease', 'skipped', 'skipped: no base to compare with'],
    ]);
    expect(result.results[1]).not.toHaveProperty('actual');
    expect(result.status).toBe('pass');
  });

  it('skips percentage limits when the base is zero', () => {
    const zero = report([webApp({ assets: [{ key: 'a', file: 'a.js', type: 'js', raw: 0 }] })]);
    const grown = report([webApp({ assets: [{ key: 'a', file: 'a.js', type: 'js', raw: 9 }] })]);
    const result = evaluateBudgets(diffReports(grown, zero), [
      budgetSchema.parse({ metric: 'js.total.raw', maxIncreasePercent: 1 }),
    ]);
    expect(result.results[0]).toMatchObject({
      status: 'skipped',
      message: 'skipped: base value is zero',
    });
  });

  it('ignores removed apps', () => {
    const removed = diffReports(report([webApp()]), base);
    const result = evaluateBudgets(removed, [
      budgetSchema.parse({ app: 'mobile', metric: '*', max: 1 }),
    ]);
    expect(result.results).toEqual([]);
  });

  describe('noisy metrics', () => {
    const runs = (p: number[]) => p.map((performance) => ({ performance, lcp: 2000 }));
    const lhBase = report([lighthouseApp(runs([80, 81, 80, 79, 80]))]);
    const lhHead = report([lighthouseApp(runs([77, 78, 77, 76, 77]))]);
    const budget = budgetSchema.parse({
      metric: 'lighthouse[*].performance',
      min: 70,
      maxDecrease: 2,
    });

    it('evaluates significant changes', () => {
      const d = diffReports(lhHead, lhBase, { noise: { performance: { floor: 1, k: 1 } } });
      const result = evaluateBudgets(d, [budget]);
      expect(result.results.map((r) => [r.limit, r.status])).toEqual([
        ['min', 'pass'],
        ['maxDecrease', 'fail'],
      ]);
    });

    it('passes change limits when the change is within noise', () => {
      const d = diffReports(lhHead, lhBase, { noise: { performance: { floor: 5, k: 1 } } });
      expect(evaluateBudgets(d, [budget]).results[1]).toMatchObject({
        status: 'pass',
        message: 'change is within measurement noise',
      });
    });

    it('skips change limits when noise is not assessed', () => {
      const d = diffReports(lhHead, lhBase, { noise: OFF });
      expect(evaluateBudgets(d, [budget]).results[1]).toMatchObject({
        status: 'skipped',
        message: 'skipped: no noise threshold configured for this metric',
      });
    });
  });
});
