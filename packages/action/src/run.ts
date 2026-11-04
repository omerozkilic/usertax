import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ConfigError,
  diffReports,
  evaluateBudgets,
  parseReport,
  renderMarkdown,
} from '@usertax/core';
import type { BudgetEvaluation, Config, Report } from '@usertax/core';
import { loadConfig } from '@usertax/measure';
import { main } from '@usertax/cli';
import { BASE_ARTIFACT_PREFIX, REPORT_FILE, findBaseReport, mergeBase } from './base.js';
import { upsertComment } from './comment.js';
import {
  InputError,
  appendSummary,
  booleanInput,
  commandMessage,
  getInput,
  requireInput,
  setOutput,
} from './env.js';
import type { Runtime } from './env.js';
import { GitHub } from './github.js';
import { resolvePullRequest } from './pr.js';
import { commitStatus, setCommitStatus } from './status.js';

const MAX_REPORT_BYTES = 20_000_000;
/** Events on the default branch whose report is stored as a base report. */
const BASE_EVENTS = new Set(['push', 'workflow_dispatch', 'schedule']);

interface Context {
  readonly rt: Runtime;
  readonly workdir: string;
  readonly eventName: string;
  readonly event: Record<string, unknown>;
}

async function readEvent(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const path = env['GITHUB_EVENT_PATH'];
  if (path === undefined || path === '') return {};
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

/** `measure`: measures the apps and writes the report; the workflow uploads it as an artifact. */
async function measure(ctx: Context): Promise<string> {
  const { env } = ctx.rt;
  const output = resolve(ctx.workdir, getInput(env, 'report') ?? REPORT_FILE);
  const args = ['measure', '--output', output];
  const config = getInput(env, 'config');
  if (config !== undefined) args.push('--config', resolve(ctx.workdir, config));
  // For pull requests, GITHUB_SHA is the merge commit; record the PR head instead.
  const pr = ctx.event['pull_request'] as { head?: { sha?: string }; number?: number } | undefined;
  if (pr?.head?.sha !== undefined) {
    args.push('--sha', pr.head.sha, '--ref', `refs/pull/${String(pr.number)}/head`);
  } else if (env['GITHUB_SHA'] !== undefined && /^[0-9a-f]{40}$/.test(env['GITHUB_SHA'])) {
    args.push('--sha', env['GITHUB_SHA']);
    if (env['GITHUB_REF'] !== undefined) args.push('--ref', env['GITHUB_REF']);
  }
  const lines: string[] = [];
  const io = { stdout: (t: string) => lines.push(t), stderr: (t: string) => lines.push(t) };
  const previous = process.cwd();
  process.chdir(ctx.workdir);
  let code: number;
  try {
    code = await main(args, io);
  } finally {
    process.chdir(previous);
  }
  for (const line of lines.join('').split('\n')) if (line !== '') ctx.rt.log(line);
  if (code !== 0) throw new InputError(`usertax measure failed with exit code ${code}`);

  const repository = ctx.event['repository'] as { default_branch?: string } | undefined;
  // Pushes store the base report; a manual or scheduled run on the default branch can recreate
  // a missing one (ADR 0014).
  const onDefaultBranch =
    BASE_EVENTS.has(ctx.eventName) &&
    env['GITHUB_REF'] === `refs/heads/${repository?.default_branch ?? 'main'}`;
  const artifact = onDefaultBranch
    ? `${BASE_ARTIFACT_PREFIX}${env['GITHUB_SHA'] ?? ''}`
    : 'usertax-head';
  await setOutput(env, 'report', output);
  await setOutput(env, 'artifact-name', artifact);
  ctx.rt.log(`report written to ${output}; upload it as the artifact "${artifact}"`);
  return output;
}

async function readHeadReport(path: string): Promise<Report> {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined)
    throw new InputError(
      `head report ${path} not found; download the measure workflow's artifact first`,
    );
  if (info.size > MAX_REPORT_BYTES)
    throw new InputError(`head report ${path} is larger than ${MAX_REPORT_BYTES} bytes`);
  return parseReport(JSON.parse(await readFile(path, 'utf8')));
}

async function loadTrustedConfig(ctx: Context): Promise<Config | undefined> {
  try {
    const file = getInput(ctx.rt.env, 'config');
    return (
      await loadConfig(ctx.workdir, file === undefined ? undefined : resolve(ctx.workdir, file))
    )?.config;
  } catch (error) {
    if (error instanceof ConfigError) throw new InputError(error.message);
    throw error;
  }
}

/** `comment`: compares the head report with the base report and posts the sticky comment. */
async function comment(ctx: Context, headPath: string): Promise<number> {
  const { env } = ctx.rt;
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const [owner, repo] = repository.split('/');
  if (owner === undefined || repo === undefined || owner === '') {
    throw new InputError(`GITHUB_REPOSITORY must be owner/repo, received "${repository}"`);
  }
  const gh = new GitHub(
    requireInput(env, 'github-token'),
    { owner, repo },
    ctx.rt.fetch,
    env['GITHUB_API_URL'] ?? 'https://api.github.com',
  );

  const head = await readHeadReport(headPath);
  const pr = await resolvePullRequest(ctx.eventName, ctx.event, gh);
  if (pr === undefined) {
    ctx.rt.log('this run does not belong to an open pull request; nothing to comment on');
    return 0;
  }
  const notes: string[] = [];
  if (head.git !== undefined && head.git.sha !== pr.headSha) {
    throw new InputError(
      `the head report was measured for ${short(head.git.sha)}, but the pull request head is ${short(pr.headSha)}`,
    );
  }
  const base = await findBaseReport(gh, await mergeBase(gh, pr.baseRef, pr.headSha));
  if (base.found && base.behind > 0) {
    notes.push(
      `The base report is from ${short(base.sha)}, ${base.behind} commit(s) before the merge base; the comparison includes changes merged in between.`,
    );
  }
  if (!base.found) {
    notes.push(
      `No base report was found for the merge base or its ${base.searched - 1} ancestors, so only head values are shown. Base reports are uploaded by the measure workflow on pushes to the default branch; to create one now, run that workflow on the default branch and update this pull request's branch.`,
    );
  }

  const config = await loadTrustedConfig(ctx);
  const compression = config?.compression ?? 'gzip';
  const diff = diffReports(head, base.found ? base.report : undefined, {
    top: config?.top ?? 10,
    rankBy: compression,
    ...(config?.noise === undefined ? {} : { noise: config.noise }),
  });
  const budgets: BudgetEvaluation | undefined =
    config === undefined || config.budgets.length === 0
      ? undefined
      : evaluateBudgets(diff, config.budgets);
  const runUrl =
    env['GITHUB_SERVER_URL'] !== undefined && env['GITHUB_RUN_ID'] !== undefined
      ? `${env['GITHUB_SERVER_URL']}/${repository}/actions/runs/${env['GITHUB_RUN_ID']}`
      : undefined;
  const options = {
    compression,
    notes,
    ...(budgets === undefined ? {} : { budgets }),
    ...(runUrl === undefined ? {} : { runUrl }),
  };

  const posted = await upsertComment(gh, pr.number, renderMarkdown(diff, options));
  ctx.rt.log(`${posted.created ? 'created' : 'updated'} ${posted.url}`);
  await appendSummary(env, renderMarkdown(diff, { ...options, marker: false }));
  await setOutput(env, 'comment-url', posted.url);
  await setOutput(env, 'status', budgets?.status ?? 'pass');
  const failOnBudget = booleanInput(env, 'fail-on-budget', true);
  if (booleanInput(env, 'commit-status', true)) {
    const status = commitStatus(budgets, failOnBudget);
    if (await setCommitStatus(gh, pr.headSha, status, posted.url, ctx.rt.log)) {
      ctx.rt.log(`commit status ${status.state}: ${status.description}`);
    }
  }
  if (budgets?.status === 'fail' && failOnBudget) {
    ctx.rt.log(
      `::error::${commandMessage('a usertax budget failed; see the pull request comment')}`,
    );
    return 1;
  }
  return 0;
}

/** Entry point of the action. Returns the process exit code. */
export async function run(rt: Runtime): Promise<number> {
  try {
    const mode = getInput(rt.env, 'mode') ?? 'measure';
    const ctx: Context = {
      rt,
      workdir: resolve(
        rt.env['GITHUB_WORKSPACE'] ?? process.cwd(),
        getInput(rt.env, 'working-directory') ?? '.',
      ),
      eventName: rt.env['GITHUB_EVENT_NAME'] ?? '',
      event: await readEvent(rt.env),
    };
    switch (mode) {
      case 'measure':
        await measure(ctx);
        return 0;
      case 'comment':
        return await comment(ctx, resolve(ctx.workdir, requireInput(rt.env, 'head-report')));
      case 'all':
        return await comment(ctx, await measure(ctx));
      default:
        throw new InputError(`input "mode" must be measure, comment or all, received "${mode}"`);
    }
  } catch (error) {
    rt.log(`::error::${commandMessage(error instanceof Error ? error.message : String(error))}`);
    return 1;
  }
}
