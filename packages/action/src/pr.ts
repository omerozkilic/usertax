import type { GitHub } from './github.js';

export interface PullRequestContext {
  readonly number: number;
  readonly headSha: string;
  readonly baseRef: string;
}

interface PullLike {
  number: number;
  head: { sha: string };
  base: { ref: string };
}

interface WorkflowRunLike {
  event?: string;
  head_sha?: string;
  head_branch?: string;
  head_repository?: { owner?: { login?: string } };
  pull_requests?: PullLike[];
}

/**
 * The pull request a run belongs to (ADR 0005). For `workflow_run`, the PR number and head SHA
 * come from the event and the API, never from the artifact; for fork PRs, where
 * `workflow_run.pull_requests` is empty, the PR is looked up by head repository and branch and
 * must have the same head SHA.
 */
export async function resolvePullRequest(
  eventName: string,
  event: Record<string, unknown>,
  gh: GitHub,
): Promise<PullRequestContext | undefined> {
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const pr = event['pull_request'] as PullLike | undefined;
    return pr === undefined
      ? undefined
      : { number: pr.number, headSha: pr.head.sha, baseRef: pr.base.ref };
  }
  if (eventName !== 'workflow_run') return undefined;
  const run = event['workflow_run'] as WorkflowRunLike | undefined;
  if (run?.event !== 'pull_request' || run.head_sha === undefined) return undefined;
  const headSha = run.head_sha;
  const listed = (run.pull_requests ?? []).find((pr) => pr.head.sha === headSha);
  if (listed !== undefined) return { number: listed.number, headSha, baseRef: listed.base.ref };
  const owner = run.head_repository?.owner?.login;
  if (owner === undefined || run.head_branch === undefined) return undefined;
  const pulls = await gh.request<PullLike[]>(
    'GET',
    `/repos/{owner}/{repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`,
  );
  const match = pulls.find((pr) => pr.head.sha === headSha);
  return match === undefined
    ? undefined
    : { number: match.number, headSha, baseRef: match.base.ref };
}
