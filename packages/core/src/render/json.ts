import type { BudgetEvaluation } from '../budgets.js';
import type { ReportDiff } from '../diff.js';

/** Machine-readable output: the diff plus the budget evaluation. */
export function renderJson(diff: ReportDiff, budgets?: BudgetEvaluation): string {
  return `${JSON.stringify(budgets === undefined ? { diff } : { diff, budgets }, null, 2)}\n`;
}
