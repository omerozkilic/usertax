import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMMENT_MARKER } from '@usertax/core';
import type { Report } from '@usertax/core';
import {
  GitHub,
  GitHubError,
  booleanInput,
  commandMessage,
  commitStatus,
  getInput,
  resolvePullRequest,
  run,
} from '@usertax/action';
import { BASE_SHA, HEAD_SHA, modify, report, webApp } from '../../core/test/fixtures.js';

const fixture = fileURLToPath(new URL('../../measure/test/fixtures/vite-dist/', import.meta.url));
const MERGE_BASE = 'c'.repeat(40);

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** A fake GitHub API: routes match "METHOD path-prefix". */
function fakeGitHub(
  routes: Record<
    string,
    (call: Call) => {
      status?: number;
      json?: unknown;
      body?: Uint8Array;
      headers?: Record<string, string>;
    }
  >,
) {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const call: Call = {
      method,
      url,
      ...(init?.body === undefined ? {} : { body: JSON.parse(init.body as string) as unknown }),
    };
    calls.push(call);
    const path = url.replace('https://api.github.com', '');
    const key = Object.keys(routes).find((route) => {
      const [m, prefix] = route.split(' ');
      return m === method && prefix !== undefined && path.startsWith(prefix);
    });
    if (key === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    const result = (
      routes[key] as (c: Call) => {
        status?: number;
        json?: unknown;
        body?: Uint8Array;
        headers?: Record<string, string>;
      }
    )(call);
    const body = result.body ?? (result.json === undefined ? null : JSON.stringify(result.json));
    return Promise.resolve(
      new Response(body, { status: result.status ?? 200, headers: result.headers ?? {} }),
    );
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function zipped(dir: string, json: unknown): Promise<Uint8Array> {
  await writeFile(join(dir, 'usertax-report.json'), JSON.stringify(json));
  execFileSync('zip', ['-q', '-j', join(dir, 'artifact.zip'), join(dir, 'usertax-report.json')]);
  return new Uint8Array(await readFile(join(dir, 'artifact.zip')));
}

describe('inputs', () => {
  it('reads, trims and parses inputs', () => {
    const env = { INPUT_MODE: ' comment ', INPUT_FAIL_ON_BUDGET: 'false', 'INPUT_HEAD-REPORT': '' };
    expect(getInput(env, 'mode')).toBe('comment');
    expect(getInput(env, 'head-report')).toBeUndefined();
    expect(booleanInput(env, 'fail_on_budget', true)).toBe(false);
    expect(booleanInput({}, 'x', true)).toBe(true);
    expect(() => booleanInput({ INPUT_X: 'maybe' }, 'x', true)).toThrow(/true or false/);
    expect(commandMessage('a%b\nc')).toBe('a%25b%0Ac');
  });
});

describe('resolvePullRequest', () => {
  const gh = (fetchFn: typeof fetch) => new GitHub('t', { owner: 'o', repo: 'r' }, fetchFn);

  it('reads pull_request events', async () => {
    const pr = await resolvePullRequest(
      'pull_request',
      { pull_request: { number: 3, head: { sha: HEAD_SHA }, base: { ref: 'main' } } },
      gh(fetch),
    );
    expect(pr).toEqual({ number: 3, headSha: HEAD_SHA, baseRef: 'main' });
  });

  it('matches workflow_run PRs by head SHA, looking fork PRs up by branch', async () => {
    const same = {
      workflow_run: {
        event: 'pull_request',
        head_sha: HEAD_SHA,
        pull_requests: [{ number: 4, head: { sha: HEAD_SHA }, base: { ref: 'main' } }],
      },
    };
    expect(await resolvePullRequest('workflow_run', same, gh(fetch))).toEqual({
      number: 4,
      headSha: HEAD_SHA,
      baseRef: 'main',
    });

    const { fetchFn, calls } = fakeGitHub({
      'GET /repos/o/r/pulls': () => ({
        json: [
          { number: 5, head: { sha: 'f'.repeat(40) }, base: { ref: 'main' } },
          { number: 6, head: { sha: HEAD_SHA }, base: { ref: 'dev' } },
        ],
      }),
    });
    const fork = {
      workflow_run: {
        event: 'pull_request',
        head_sha: HEAD_SHA,
        head_branch: 'feat',
        head_repository: { owner: { login: 'someone' } },
        pull_requests: [],
      },
    };
    expect(await resolvePullRequest('workflow_run', fork, gh(fetchFn))).toEqual({
      number: 6,
      headSha: HEAD_SHA,
      baseRef: 'dev',
    });
    expect(calls[0]?.url).toContain('head=someone%3Afeat');
  });

  it('ignores other events', async () => {
    expect(await resolvePullRequest('push', {}, gh(fetch))).toBeUndefined();
    expect(
      await resolvePullRequest(
        'workflow_run',
        { workflow_run: { event: 'push', head_sha: HEAD_SHA } },
        gh(fetch),
      ),
    ).toBeUndefined();
    expect(
      await resolvePullRequest(
        'workflow_run',
        { workflow_run: { event: 'pull_request', head_sha: HEAD_SHA } },
        gh(fetch),
      ),
    ).toBeUndefined();
  });
});

describe('GitHub client', () => {
  it('throws GitHubError with the status', async () => {
    const { fetchFn } = fakeGitHub({});
    await expect(
      new GitHub('t', { owner: 'o', repo: 'r' }, fetchFn).request('GET', '/x'),
    ).rejects.toEqual(new GitHubError('GitHub API GET /x failed with 404', 404));
  });

  it('downloads artifacts through the redirect without sending the token there', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchFn = ((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      if (url.includes('/zip'))
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: 'https://blob.example/a.zip' } }),
        );
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    }) as typeof fetch;
    const bytes = await new GitHub('secret', { owner: 'o', repo: 'r' }, fetchFn).downloadArtifact(
      7,
    );
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(seen).toEqual([
      { url: 'https://api.github.com/repos/o/r/actions/artifacts/7/zip', auth: 'Bearer secret' },
      { url: 'https://blob.example/a.zip', auth: null },
    ]);
  });
});

describe('run', () => {
  let work: string;
  let headPath: string;
  let event: string;
  const base: Report = report([webApp()], { git: { sha: MERGE_BASE } });
  const head: Report = modify(base, (r) => {
    r.git = { sha: HEAD_SHA };
    const asset = r.apps[0]?.assets?.[0];
    if (asset) asset.gzip = 45_000;
  });

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'usertax-action-'));
    headPath = join(work, 'head.json');
    await writeFile(headPath, JSON.stringify(head));
    event = join(work, 'event.json');
    await writeFile(
      event,
      JSON.stringify({
        workflow_run: {
          event: 'pull_request',
          head_sha: HEAD_SHA,
          pull_requests: [{ number: 12, head: { sha: HEAD_SHA }, base: { ref: 'main' } }],
        },
      }),
    );
  });

  function env(extra: Record<string, string> = {}) {
    return {
      GITHUB_WORKSPACE: work,
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '99',
      GITHUB_OUTPUT: join(work, 'output.txt'),
      GITHUB_STEP_SUMMARY: join(work, 'summary.md'),
      INPUT_MODE: 'comment',
      'INPUT_HEAD-REPORT': headPath,
      'INPUT_GITHUB-TOKEN': 'token',
      ...extra,
    };
  }

  function routes(zip: Uint8Array | undefined, comments: unknown[] = [], statusCode = 201) {
    return fakeGitHub({
      'POST /repos/o/r/statuses/': () => ({ status: statusCode, json: {} }),
      'GET /repos/o/r/compare/main...': () => ({
        json: { merge_base_commit: { sha: MERGE_BASE } },
      }),
      'GET /repos/o/r/commits?sha=': () => ({ json: [{ sha: MERGE_BASE }, { sha: BASE_SHA }] }),
      'GET /repos/o/r/actions/artifacts?name=': (call) => ({
        json: {
          artifacts:
            zip !== undefined && call.url.includes(MERGE_BASE)
              ? [{ id: 5, name: `usertax-base-${MERGE_BASE}`, expired: false }]
              : [],
        },
      }),
      'GET /repos/o/r/actions/artifacts/5/zip': () => ({ body: zip ?? new Uint8Array() }),
      'GET /repos/o/r/issues/12/comments': () => ({ json: comments }),
      'POST /repos/o/r/issues/12/comments': () => ({
        status: 201,
        json: { id: 1, html_url: 'https://github.com/o/r/pull/12#c1' },
      }),
      'PATCH /repos/o/r/issues/comments/': () => ({
        json: { id: 8, html_url: 'https://github.com/o/r/pull/12#c8' },
      }),
    });
  }

  it('compares with the base artifact and creates the sticky comment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-zip-'));
    const { fetchFn, calls } = routes(await zipped(dir, base));
    const logs: string[] = [];
    expect(await run({ env: env(), fetch: fetchFn, log: (l) => logs.push(l) })).toBe(0);
    const post = calls.find((c) => c.method === 'POST');
    const body = (post?.body as { body: string }).body;
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain(`Base \`${MERGE_BASE.slice(0, 7)}\` → head \`${HEAD_SHA.slice(0, 7)}\``);
    expect(body).toContain('[workflow run](https://github.com/o/r/actions/runs/99)');
    expect(logs).toContain('created https://github.com/o/r/pull/12#c1');
    const status = calls.find((c) => c.url.includes('/statuses/'));
    expect(status?.url).toBe(`https://api.github.com/repos/o/r/statuses/${HEAD_SHA}`);
    expect(status?.body).toEqual({
      state: 'success',
      context: 'usertax',
      description: 'Report posted; no budgets configured',
      target_url: 'https://github.com/o/r/pull/12#c1',
    });
    expect(await readFile(join(work, 'summary.md'), 'utf8')).not.toContain(COMMENT_MARKER);
    expect(await readFile(join(work, 'output.txt'), 'utf8')).toMatch(/status<<[^\n]+\npass\n/);
  });

  it('updates the existing comment and fails on budgets', async () => {
    await writeFile(
      join(work, 'usertax.config.json'),
      JSON.stringify({ budgets: [{ metric: 'js.total.gzip', maxIncrease: '1 kB' }] }),
    );
    const dir = await mkdtemp(join(tmpdir(), 'usertax-zip-'));
    const comments = [
      { id: 7, html_url: 'x', body: `${COMMENT_MARKER}\nold`, user: { type: 'User' } },
      { id: 8, html_url: 'y', body: `${COMMENT_MARKER}\nold`, user: { type: 'Bot' } },
    ];
    const { fetchFn, calls } = routes(await zipped(dir, base), comments);
    const logs: string[] = [];
    expect(await run({ env: env(), fetch: fetchFn, log: (l) => logs.push(l) })).toBe(1);
    expect(calls.find((c) => c.method === 'PATCH')?.url).toContain('/issues/comments/8');
    expect(logs).toContain('::error::a usertax budget failed; see the pull request comment');
    expect(calls.find((c) => c.url.includes('/statuses/'))?.body).toMatchObject({
      state: 'failure',
      description: 'Budgets: 1 failed',
    });
    calls.length = 0;
    expect(
      await run({
        env: env({ 'INPUT_FAIL-ON-BUDGET': 'false' }),
        fetch: fetchFn,
        log: () => undefined,
      }),
    ).toBe(0);
    expect(calls.find((c) => c.url.includes('/statuses/'))?.body).toMatchObject({
      state: 'success',
      description: 'Budgets: 1 failed (not blocking)',
    });
    await writeFile(join(work, 'usertax.config.json'), '{}');
  });

  it('explains a missing base and shows head values', async () => {
    const { fetchFn, calls } = routes(undefined);
    expect(await run({ env: env(), fetch: fetchFn, log: () => undefined })).toBe(0);
    const body = (calls.find((c) => c.method === 'POST')?.body as { body: string }).body;
    expect(body).toContain('No base report was found for the merge base or its 1 ancestors');
    expect(body).toContain('no base report to compare with');
  });

  it('still comments without statuses: write, and can skip the status', async () => {
    const denied = routes(undefined, [], 403);
    const logs: string[] = [];
    expect(await run({ env: env(), fetch: denied.fetchFn, log: (l) => logs.push(l) })).toBe(0);
    expect(logs).toContainEqual(expect.stringMatching(/^::warning::could not set the usertax/));
    expect(denied.calls.some((c) => c.url.includes('/issues/12/comments'))).toBe(true);

    const off = routes(undefined);
    const env2 = env({ 'INPUT_COMMIT-STATUS': 'false' });
    expect(await run({ env: env2, fetch: off.fetchFn, log: () => undefined })).toBe(0);
    expect(off.calls.some((c) => c.url.includes('/statuses/'))).toBe(false);

    const broken = routes(undefined, [], 500);
    const errors: string[] = [];
    expect(await run({ env: env(), fetch: broken.fetchFn, log: (l) => errors.push(l) })).toBe(1);
    expect(errors.at(-1)).toMatch(/statuses\/.* failed with 500/);
  });

  it('refuses a report measured for another commit, and runs without a PR quietly', async () => {
    const other = join(work, 'other.json');
    await writeFile(
      other,
      JSON.stringify(
        modify(head, (r) => {
          r.git = { sha: 'd'.repeat(40) };
        }),
      ),
    );
    const logs: string[] = [];
    expect(
      await run({
        env: env({ 'INPUT_HEAD-REPORT': other }),
        fetch: routes(undefined).fetchFn,
        log: (l) => logs.push(l),
      }),
    ).toBe(1);
    expect(logs[0]).toMatch(/measured for ddddddd, but the pull request head is bbbbbbb/);

    const push = join(work, 'push.json');
    await writeFile(push, '{}');
    const quiet: string[] = [];
    expect(
      await run({
        env: env({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: push }),
        fetch: routes(undefined).fetchFn,
        log: (l) => quiet.push(l),
      }),
    ).toBe(0);
    expect(quiet).toEqual([
      'this run does not belong to an open pull request; nothing to comment on',
    ]);
  });

  it('reports bad inputs as errors', async () => {
    const logs: string[] = [];
    expect(await run({ env: env({ INPUT_MODE: 'deploy' }), fetch, log: (l) => logs.push(l) })).toBe(
      1,
    );
    expect(
      await run({
        env: env({ 'INPUT_HEAD-REPORT': join(work, 'missing.json') }),
        fetch,
        log: (l) => logs.push(l),
      }),
    ).toBe(1);
    expect(
      await run({ env: env({ GITHUB_REPOSITORY: 'nope' }), fetch, log: (l) => logs.push(l) }),
    ).toBe(1);
    expect(logs).toEqual([
      '::error::input "mode" must be measure, comment or all, received "deploy"',
      expect.stringContaining('not found; download the measure workflow'),
      '::error::GITHUB_REPOSITORY must be owner/repo, received "nope"',
    ]);
  });

  it('measures, names the artifact and can comment in one job', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'usertax-action-repo-'));
    await writeFile(join(repo, 'package.json'), '{"name":"web","devDependencies":{"vite":"8"}}');
    await cp(fixture, join(repo, 'dist'), { recursive: true });
    await mkdir(join(repo, 'events'));
    const pushEvent = join(repo, 'events', 'push.json');
    await writeFile(pushEvent, JSON.stringify({ repository: { default_branch: 'main' } }));
    const output = join(repo, 'out.txt');
    const measureEnv = {
      GITHUB_WORKSPACE: repo,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: pushEvent,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: MERGE_BASE,
      GITHUB_OUTPUT: output,
    };
    expect(await run({ env: measureEnv, fetch, log: () => undefined })).toBe(0);
    const outputs = await readFile(output, 'utf8');
    expect(outputs).toContain(`usertax-base-${MERGE_BASE}`);
    // A manual run on the default branch recreates the base report (ADR 0014).
    await writeFile(output, '');
    const dispatch = { ...measureEnv, GITHUB_EVENT_NAME: 'workflow_dispatch' };
    expect(await run({ env: dispatch, fetch, log: () => undefined })).toBe(0);
    expect(await readFile(output, 'utf8')).toContain(`usertax-base-${MERGE_BASE}`);
    await writeFile(output, '');
    const otherBranch = { ...dispatch, GITHUB_REF: 'refs/heads/feature' };
    expect(await run({ env: otherBranch, fetch, log: () => undefined })).toBe(0);
    expect(await readFile(output, 'utf8')).toContain('usertax-head');
    expect(JSON.parse(await readFile(join(repo, 'usertax-report.json'), 'utf8'))).toHaveProperty(
      'git.sha',
      MERGE_BASE,
    );

    const prEvent = join(repo, 'events', 'pr.json');
    await writeFile(
      prEvent,
      JSON.stringify({
        pull_request: { number: 12, head: { sha: HEAD_SHA }, base: { ref: 'main' } },
      }),
    );
    const { fetchFn, calls } = routes(undefined);
    const all = {
      ...measureEnv,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: prEvent,
      GITHUB_REF: 'refs/pull/12/merge',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_MODE: 'all',
      'INPUT_GITHUB-TOKEN': 't',
      INPUT_REPORT: 'pr.json',
    };
    expect(await run({ env: all, fetch: fetchFn, log: () => undefined })).toBe(0);
    expect(JSON.parse(await readFile(join(repo, 'pr.json'), 'utf8'))).toHaveProperty('git', {
      sha: HEAD_SHA,
      ref: 'refs/pull/12/head',
    });
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    expect(await readFile(output, 'utf8')).toContain('usertax-head');

    const broken = { ...measureEnv, GITHUB_OUTPUT: '', INPUT_CONFIG: 'missing.json' };
    const logs: string[] = [];
    expect(await run({ env: broken, fetch, log: (l) => logs.push(l) })).toBe(1);
    expect(logs.join('\n')).toContain('usertax measure failed with exit code 2');
  });
});

describe('commitStatus', () => {
  const result = (status: 'pass' | 'warn' | 'fail' | 'skipped') => ({
    appId: 'web',
    metricId: 'js.total.gzip',
    label: 'JS total',
    status,
    limit: 'max',
    threshold: 1,
    unit: 'bytes' as const,
    message: '',
  });

  it('summarises budget results in the description', () => {
    expect(
      commitStatus(
        {
          status: 'warn',
          unmatched: [],
          results: [result('warn'), result('pass'), result('pass'), result('skipped')],
        },
        true,
      ),
    ).toEqual({ state: 'success', description: 'Budgets: 1 warned, 2 passed, 1 skipped' });
    expect(commitStatus({ status: 'pass', unmatched: [], results: [] }, true)).toEqual({
      state: 'success',
      description: 'Report posted; no budgets configured',
    });
  });
});
