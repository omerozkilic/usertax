import type { BudgetEvaluation } from '@usertax/core';
import { GitHubError } from './github.js';
import type { GitHub } from './github.js';

/** The commit status context, shown as the check name on the pull request. */
export const STATUS_CONTEXT = 'usertax';

export interface CommitStatus {
  readonly state: 'success' | 'failure';
  readonly description: string;
}

/**
 * The commit status for a comparison. The comment job runs in `workflow_run`, so its own result
 * is not shown on the pull request; the status is (ADR 0005). It fails only when a budget fails
 * and `fail-on-budget` is on.
 */
export function commitStatus(
  budgets: BudgetEvaluation | undefined,
  failOnBudget: boolean,
): CommitStatus {
  if (budgets === undefined || budgets.results.length === 0) {
    return { state: 'success', description: 'Report posted; no budgets configured' };
  }
  const count = (status: string) => budgets.results.filter((r) => r.status === status).length;
  const parts = [
    ['failed', count('fail')],
    ['warned', count('warn')],
    ['passed', count('pass')],
    ['skipped', count('skipped')],
  ]
    .filter(([, n]) => n !== 0)
    .map(([label, n]) => `${String(n)} ${String(label)}`);
  const failed = budgets.status === 'fail';
  return {
    state: failed && failOnBudget ? 'failure' : 'success',
    description: `Budgets: ${parts.join(', ')}${failed && !failOnBudget ? ' (not blocking)' : ''}`,
  };
}

/**
 * Sets the commit status on the pull request head. A token without `statuses: write` only logs
 * a warning, so the comment still works with the minimal permissions of earlier setups.
 */
export async function setCommitStatus(
  gh: GitHub,
  sha: string,
  status: CommitStatus,
  targetUrl: string | undefined,
  log: (line: string) => void,
): Promise<boolean> {
  try {
    await gh.request('POST', `/repos/{owner}/{repo}/statuses/${encodeURIComponent(sha)}`, {
      state: status.state,
      context: STATUS_CONTEXT,
      description: status.description.slice(0, 140),
      ...(targetUrl === undefined ? {} : { target_url: targetUrl }),
    });
    return true;
  } catch (error) {
    if (!(error instanceof GitHubError) || (error.status !== 403 && error.status !== 404))
      throw error;
    log(
      '::warning::could not set the usertax commit status; give the workflow `statuses: write` or set commit-status to false',
    );
    return false;
  }
}
