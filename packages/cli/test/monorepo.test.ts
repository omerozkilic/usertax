import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReport } from '@usertax/core';
import { main } from '@usertax/cli';

const fixture = fileURLToPath(new URL('../../measure/test/fixtures/vite-dist/', import.meta.url));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

async function workspace(files: Record<string, string>, builtApps: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'usertax-mono-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  for (const app of builtApps) await cp(fixture, join(root, app), { recursive: true });
  return root;
}

const vite = (name: string) => JSON.stringify({ name, devDependencies: { vite: '8' } });

describe('usertax measure in a monorepo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('measures every discovered workspace app into one report', async () => {
    const root = await workspace(
      {
        'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
        'apps/web/package.json': vite('web'),
        'apps/admin/package.json': vite('admin'),
        'apps/bare/package.json': '{"name":"bare","dependencies":{"react-native":"0.88"}}',
      },
      ['apps/web/dist', 'apps/admin/dist'],
    );
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const c = capture();
    expect(await main(['measure', '--sha', 'a'.repeat(40)], c.io)).toBe(0);
    const report = parseReport(JSON.parse(c.out()));
    expect(report.apps.map((a) => [a.id, a.path])).toEqual([
      ['admin', 'apps/admin'],
      ['web', 'apps/web'],
    ]);
    expect(c.err()).toContain(
      'skipping apps/bare: bare React Native apps need bundles or archives',
    );
    expect(c.err()).toContain('apps/web: warning: no lockfile found');
  });

  it('measures the apps of the configuration with their options', async () => {
    const root = await workspace(
      {
        'usertax.config.json': JSON.stringify({
          apps: [{ path: 'apps/web', id: 'website', outDir: 'build' }, { path: 'apps/admin' }],
        }),
        'apps/web/package.json': vite('web'),
        'apps/admin/package.json': vite('admin'),
      },
      ['apps/web/build', 'apps/admin/dist'],
    );
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const c = capture();
    expect(await main(['measure', '--sha', 'a'.repeat(40)], c.io)).toBe(0);
    expect(parseReport(JSON.parse(c.out())).apps.map((a) => a.id)).toEqual(['website', 'admin']);

    // A single app directory picks up its configuration entry.
    const one = capture();
    expect(await main(['measure', join(root, 'apps/web'), '--sha', 'a'.repeat(40)], one.io)).toBe(
      0,
    );
    expect(parseReport(JSON.parse(one.out())).apps.map((a) => a.id)).toEqual(['website']);
  });

  it('uses flags for the only app of a workspace', async () => {
    const root = await workspace({ 'package.json': vite('solo') }, ['out']);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const c = capture();
    expect(
      await main(
        ['measure', '--out-dir', 'out', '--id', 'solo-app', '--sha', 'a'.repeat(40)],
        c.io,
      ),
    ).toBe(0);
    expect(parseReport(JSON.parse(c.out())).apps[0]?.id).toBe('solo-app');
  });

  it('rejects per-app flags with several apps, duplicate ids and invalid configuration', async () => {
    const root = await workspace(
      {
        'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
        'apps/a/package.json': vite('same'),
        'apps/b/package.json': vite('same'),
      },
      ['apps/a/dist', 'apps/b/dist'],
    );
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const flags = capture();
    expect(await main(['measure', '--out-dir', 'x'], flags.io)).toBe(2);
    expect(flags.err()).toContain('--out-dir applies to one app');
    const duplicate = capture();
    expect(await main(['measure'], duplicate.io)).toBe(2);
    expect(duplicate.err()).toContain('two apps have the id "same"');

    await writeFile(join(root, 'usertax.config.json'), '{"apps": []}');
    const invalid = capture();
    expect(await main(['measure'], invalid.io)).toBe(2);
    expect(invalid.err()).toContain('invalid');
    const missing = capture();
    expect(await main(['measure', '--config', 'nope.json'], missing.io)).toBe(2);
    expect(missing.err()).toContain('not found');
  });
});

describe('usertax diff with a configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluates budgets, renders them and exits with 1 when one fails', async () => {
    const root = await workspace({ 'package.json': vite('web') }, ['dist']);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const measured = capture();
    expect(
      await main(['measure', '--sha', 'a'.repeat(40), '-o', join(root, 'head.json')], measured.io),
    ).toBe(0);
    await writeFile(
      join(root, 'usertax.config.json'),
      JSON.stringify({
        budgets: [
          { metric: 'js.total.gzip', max: '1 kB' },
          { metric: 'css.total.gzip', max: '1 MB', level: 'warn' },
        ],
        compression: 'brotli',
        top: 2,
      }),
    );
    const c = capture();
    expect(await main(['diff', join(root, 'head.json')], c.io)).toBe(1);
    expect(c.out()).toContain('### Budgets');
    expect(c.out()).toContain('JS total (brotli)');
    const json = capture();
    expect(await main(['diff', join(root, 'head.json'), '-f', 'json'], json.io)).toBe(1);
    expect(JSON.parse(json.out())).toHaveProperty('budgets.status', 'fail');

    await writeFile(
      join(root, 'usertax.config.json'),
      JSON.stringify({ budgets: [{ metric: 'js.total.gzip', max: '1 MB' }] }),
    );
    expect(await main(['diff', join(root, 'head.json')], capture().io)).toBe(0);
    await writeFile(join(root, 'usertax.config.json'), '{"budgets": [{}]}');
    const broken = capture();
    expect(await main(['diff', join(root, 'head.json')], broken.io)).toBe(2);
    expect(broken.err()).toContain('invalid');
  });
});
