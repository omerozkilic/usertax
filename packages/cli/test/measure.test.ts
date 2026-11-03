import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseReport } from '@usertax/core';
import { main } from 'usertax';

const fixture = new URL('../../measure/test/fixtures/vite-dist/', import.meta.url);

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('usertax measure', () => {
  let app: string;

  beforeAll(async () => {
    app = await mkdtemp(join(tmpdir(), 'usertax-measure-'));
    await cp(fixture, join(app, 'dist'), { recursive: true });
    await writeFile(
      join(app, 'package.json'),
      JSON.stringify({ name: '@acme/web', devDependencies: { vite: '8' } }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('measures a built Vite app and prints a valid report', async () => {
    vi.stubEnv('GITHUB_SHA', 'e'.repeat(40));
    vi.stubEnv('GITHUB_REF', 'refs/pull/7/merge');
    const c = capture();
    expect(await main(['measure', app], c.io)).toBe(0);
    expect(c.err()).toBe('warning: no lockfile found; package changes will not be explained\n');
    const report = parseReport(JSON.parse(c.out()));
    expect(report.git).toEqual({ sha: 'e'.repeat(40), ref: 'refs/pull/7/merge' });
    expect(report.apps[0]).toMatchObject({
      id: '@acme/web',
      name: '@acme/web',
      framework: 'vite',
      kind: 'web',
    });
    expect(report.apps[0]?.routes?.map((r) => r.route)).toEqual(['/', '/about/']);
  });

  it('accepts explicit options and writes to a file', async () => {
    vi.stubEnv('GITHUB_SHA', '');
    const output = join(app, 'report.json');
    const c = capture();
    const args = [
      'measure',
      app,
      '--framework',
      'static',
      '--id',
      'web',
      '--name',
      'Web',
      '--sha',
      'd'.repeat(40),
      '--ref',
      'main',
      '-o',
      output,
    ];
    expect(await main(args, c.io)).toBe(0);
    const report = parseReport(JSON.parse(await readFile(output, 'utf8')));
    expect(report.git).toEqual({ sha: 'd'.repeat(40), ref: 'main' });
    expect(report.apps[0]).toMatchObject({ id: 'web', name: 'Web', framework: 'static' });
    expect(report.apps[0]).not.toHaveProperty('routes');
  });

  it('records dependencies from the nearest lockfile', async () => {
    const withLock = await mkdtemp(join(tmpdir(), 'usertax-lock-'));
    await cp(fixture, join(withLock, 'dist'), { recursive: true });
    await cp(new URL('../../measure/test/fixtures/lockfiles/npm/', import.meta.url), withLock, {
      recursive: true,
    });
    const c = capture();
    expect(
      await main(['measure', withLock, '--framework', 'vite', '--sha', 'a'.repeat(40)], c.io),
    ).toBe(0);
    expect(c.err()).toBe('');
    expect(parseReport(JSON.parse(c.out())).apps[0]?.dependencies).toEqual([
      { name: 'ms', version: '2.1.3', direct: true },
    ]);
  });

  it('warns about unreadable lockfiles', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'usertax-broken-'));
    await cp(fixture, join(broken, 'dist'), { recursive: true });
    await writeFile(join(broken, 'package.json'), '{"devDependencies":{"vite":"8"}}');
    await writeFile(join(broken, 'package-lock.json'), '{"lockfileVersion":1}');
    const c = capture();
    expect(await main(['measure', broken, '--sha', 'a'.repeat(40)], c.io)).toBe(0);
    expect(c.err()).toContain('warning: lockfile ignored: unsupported package-lock.json');
    expect(parseReport(JSON.parse(c.out())).apps[0]).not.toHaveProperty('dependencies');
  });

  it('prints its own help', async () => {
    const c = capture();
    expect(await main(['measure', '--help'], c.io)).toBe(0);
    expect(c.out()).toContain("build.sourcemap to 'hidden'");
  });

  it('prints source map warnings to stderr', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'usertax-bare-'));
    await writeFile(join(bare, 'package.json'), '{}');
    const dist = join(bare, 'dist');
    await cp(fixture, dist, { recursive: true, filter: (src) => !src.endsWith('.map') });
    const c = capture();
    expect(await main(['measure', bare, '--sha', 'a'.repeat(40)], c.io)).toBe(0);
    expect(c.err()).toContain('warning: assets/main-DOR0Mk0h.js: no source map found');
    expect(parseReport(JSON.parse(c.out())).apps[0]?.id).toMatch(/^usertax-bare-/);
  });

  it.each([
    [['a', 'b'], 'unexpected arguments: b'],
    [['--framework', 'gatsby'], 'unknown framework "gatsby"'],
    [['--framework', 'next'], 'measuring next apps is not supported yet'],
    [['--out-dir', 'nope'], 'not found; build the app first'],
    [['--sha', 'abc'], '--sha must be a full 40-character commit SHA'],
  ])('rejects %j', async (args, expected) => {
    const c = capture();
    const withApp = args[0] === 'a' ? args : [app, ...args];
    expect(await main(['measure', ...withApp], c.io)).toBe(2);
    expect(c.err()).toContain(expected);
  });
});
