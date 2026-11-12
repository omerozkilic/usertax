import { z } from 'zod';
import type { MetricDiff, ReportDiff } from './diff.js';
import { matchesGlob } from './glob.js';
import { parsePercent, parseQuantity } from './quantity.js';

const quantity = z.union([z.number(), z.string().min(1).max(50)]);

export const budgetSchema = z
  .object({
    /** Glob over app ids. Defaults to every app. */
    app: z.string().min(1).max(200).default('*'),
    /** Glob over metric ids, e.g. `js.total.gzip` or `route[*].js.brotli`. */
    metric: z.string().min(1).max(512),
    max: quantity.optional(),
    min: quantity.optional(),
    maxIncrease: quantity.optional(),
    maxDecrease: quantity.optional(),
    maxIncreasePercent: quantity.optional(),
    maxDecreasePercent: quantity.optional(),
    level: z.enum(['warn', 'fail']).default('fail'),
  })
  .refine(
    (b) =>
      [b.max, b.min, b.maxIncrease, b.maxDecrease, b.maxIncreasePercent, b.maxDecreasePercent].some(
        (limit) => limit !== undefined,
      ),
    { message: 'a budget needs at least one limit (max, min, maxIncrease, …)' },
  );
export type Budget = z.output<typeof budgetSchema>;
export type BudgetInput = z.input<typeof budgetSchema>;

export type BudgetStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface BudgetResult {
  readonly appId: string;
  readonly metricId: string;
  readonly label: string;
  readonly status: BudgetStatus;
  /** Which limit was evaluated, e.g. `max` or `maxIncreasePercent`. */
  readonly limit: string;
  /** The limit in metric units (or percent). */
  readonly threshold: number;
  /** The value compared with the threshold; absent when skipped. */
  readonly actual?: number;
  readonly unit: MetricDiff['unit'] | 'percent';
  readonly message: string;
}

export interface BudgetEvaluation {
  readonly results: readonly BudgetResult[];
  readonly status: 'pass' | 'warn' | 'fail';
  /** Budgets whose metric pattern matched nothing; usually a typo. */
  readonly unmatched: readonly Budget[];
}

interface Check {
  readonly limit: string;
  readonly threshold: number;
  readonly unit: BudgetResult['unit'];
  /** Undefined when the check cannot be evaluated. */
  readonly actual: number | undefined;
  readonly exceeded: (actual: number) => boolean;
  readonly skipReason?: string;
  readonly note?: string;
}

function checksFor(budget: Budget, metric: MetricDiff): Check[] {
  const checks: Check[] = [];
  const unit = metric.unit;
  const noBase = metric.base === undefined ? 'no base to compare with' : undefined;
  const changeCheck = (
    limit: string,
    raw: number | string | undefined,
    percent: boolean,
    sign: 1 | -1,
  ) => {
    if (raw === undefined) return;
    const threshold = percent ? parsePercent(raw) : parseQuantity(raw, unit);
    const value = percent ? metric.percent : metric.delta;
    const actual = value === undefined ? undefined : value * sign;
    checks.push({
      limit,
      threshold,
      unit: percent ? 'percent' : unit,
      actual,
      exceeded: (a) => a > threshold,
      ...(noBase !== undefined
        ? { skipReason: noBase }
        : actual === undefined
          ? { skipReason: 'base value is zero' }
          : {}),
    });
  };

  if (budget.max !== undefined && metric.head !== undefined) {
    const threshold = parseQuantity(budget.max, unit);
    checks.push({
      limit: 'max',
      threshold,
      unit,
      actual: metric.head,
      exceeded: (a) => a > threshold,
    });
  }
  if (budget.min !== undefined && metric.head !== undefined) {
    const threshold = parseQuantity(budget.min, unit);
    checks.push({
      limit: 'min',
      threshold,
      unit,
      actual: metric.head,
      exceeded: (a) => a < threshold,
    });
  }
  changeCheck('maxIncrease', budget.maxIncrease, false, 1);
  changeCheck('maxDecrease', budget.maxDecrease, false, -1);
  changeCheck('maxIncreasePercent', budget.maxIncreasePercent, true, 1);
  changeCheck('maxDecreasePercent', budget.maxDecreasePercent, true, -1);

  // A run with browser extensions active measures the extensions as much as the page.
  if (metric.contamination !== undefined) {
    return checks.map((check) => ({
      ...check,
      skipReason: 'Lighthouse ran with browser extensions active',
    }));
  }

  // Change budgets on noisy metrics respect the noise model (ADR 0007).
  return checks.map((check) => {
    const isChangeCheck = check.limit !== 'max' && check.limit !== 'min';
    if (!isChangeCheck || check.skipReason !== undefined) return check;
    if (metric.significance === 'within-noise') {
      return { ...check, exceeded: () => false, note: 'change is within measurement noise' };
    }
    if (metric.significance === 'unassessed') {
      return { ...check, skipReason: 'no noise threshold configured for this metric' };
    }
    return check;
  });
}

function describe(check: Check, status: BudgetStatus): string {
  if (status === 'skipped') return `skipped: ${check.skipReason ?? 'not evaluated'}`;
  if (status === 'pass') return check.note ?? `${check.limit} within limit`;
  return check.limit === 'min' ? 'below min' : `${check.limit} exceeded`;
}

/** Evaluates budgets against a diff. Budgets must already be parsed with {@link budgetSchema}. */
export function evaluateBudgets(diff: ReportDiff, budgets: readonly Budget[]): BudgetEvaluation {
  const results: BudgetResult[] = [];
  const unmatched: Budget[] = [];
  for (const budget of budgets) {
    let matched = false;
    for (const app of diff.apps) {
      if (app.status === 'removed' || !matchesGlob(app.id, budget.app)) continue;
      for (const metric of app.metrics) {
        if (metric.head === undefined || !matchesGlob(metric.id, budget.metric)) continue;
        matched = true;
        for (const check of checksFor(budget, metric)) {
          let status: BudgetStatus;
          if (check.skipReason !== undefined || check.actual === undefined) status = 'skipped';
          else if (check.exceeded(check.actual)) status = budget.level;
          else status = 'pass';
          results.push({
            appId: app.id,
            metricId: metric.id,
            label: metric.label,
            status,
            limit: check.limit,
            threshold: check.threshold,
            ...(check.actual === undefined || status === 'skipped' ? {} : { actual: check.actual }),
            unit: check.unit,
            message: describe(check, status),
          });
        }
      }
    }
    if (!matched) unmatched.push(budget);
  }
  const status = results.some((r) => r.status === 'fail')
    ? 'fail'
    : results.some((r) => r.status === 'warn')
      ? 'warn'
      : 'pass';
  return { results, status, unmatched };
}
