import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { main } from '@usertax/cli';
import {
  appNotes,
  detectPackageManager,
  initCommand,
  measureWorkflow,
  starterConfig,
} from '../src/commands/init.js';

function capture() {
  const out: string[] = [];
  return { io: { stdout: (t: string) => out.push(t), stderr: (t: string) => out.push(t) }, out };
}

/** A pnpm monorepo with a Vite app (no source-map config), a Next.js app (configured) and Expo. */
async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'usertax-init-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'acme', private: true, scripts: { build: 'pnpm -r build' } }),
  );
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  const app = async (name: string, deps: Record<string, string>, files: Record<string, string>) => {
    await mkdir(join(root, 'apps', name), { recursive: true });
    await writeFile(
      join(root, 'apps', name, 'package.json'),
      JSON.stringify({ name, dependencies: deps }),
    );
    for (const [file, text] of Object.entries(files)) {
      await writeFile(join(root, 'apps', name, file), text);
    }
  };
  await app('web', { vite: '8' }, { 'vite.config.ts': 'export default {}' });
  await app(
    'site',
    { next: '16' },
    { 'next.config.mjs': 'export default { productionBrowserSourceMaps: true }' },
  );
  await app('mobile', { expo: '58', 'react-native': '0.88' }, {});
  await mkdir(join(root, '.git', 'refs', 'remotes', 'origin'), { recursive: true });
  await writeFile(
    join(root, '.git', 'refs', 'remotes', 'origin', 'HEAD'),
    'ref: refs/remotes/origin/trunk\n',
  );
  return root;
}

describe('usertax init', () => {
  it('writes the fork-safe workflows and a starter configuration', async () => {
    const root = await repo();
    const c = capture();
    expect(await initCommand(['--budget'], c.io, { cwd: root })).toBe(0);
    const measure = await readFile(join(root, '.github/workflows/usertax.yml'), 'utf8');
    const comment = await readFile(join(root, '.github/workflows/usertax-comment.yml'), 'utf8');
    await expect(measure).toMatchFileSnapshot('./__snapshots__/init-usertax.yml');
    await expect(comment).toMatchFileSnapshot('./__snapshots__/init-usertax-comment.yml');

    const workflow = parse(measure) as {
      on: { push: { branches: string[] } };
      permissions: Record<string, string>;
      jobs: { usertax: { steps: { run?: string; with?: Record<string, unknown> }[] } };
    };
    expect(workflow.on.push.branches).toEqual(['trunk']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const runs = workflow.jobs.usertax.steps.flatMap((s) => (s.run === undefined ? [] : [s.run]));
    expect(runs).toEqual(['pnpm install --frozen-lockfile', 'pnpm run build']);
    const commentWorkflow = parse(comment) as { permissions: Record<string, string> };
    expect(commentWorkflow.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      'pull-requests': 'write',
      statuses: 'write',
    });

    const config = JSON.parse(await readFile(join(root, 'usertax.config.json'), 'utf8')) as {
      budgets: { metric: string }[];
    };
    expect(config.budgets.map((b) => b.metric)).toEqual(['route[*].js.gzip', 'bundle[*].raw']);

    const output = c.out.join('');
    expect(output).toContain(
      'Package manager: pnpm · apps: apps/mobile (expo), apps/site (next), apps/web (vite)',
    );
    expect(output).toContain("apps/web (Vite): set build.sourcemap to 'hidden'");
    expect(output).not.toContain('apps/site (Next.js)');
    expect(output).toContain('apps/mobile (Expo): the build must run');
    expect(output).toContain('push them to trunk');
  });

  it('keeps existing files unless --force, and prints with --dry-run', async () => {
    const root = await repo();
    await mkdir(join(root, '.github/workflows'), { recursive: true });
    await writeFile(join(root, '.github/workflows/usertax.yml'), 'mine');
    const c = capture();
    await initCommand([], c.io, { cwd: root });
    expect(await readFile(join(root, '.github/workflows/usertax.yml'), 'utf8')).toBe('mine');
    expect(c.out.join('')).toContain('skipped .github/workflows/usertax.yml (exists');
    await initCommand(['--force'], capture().io, { cwd: root });
    expect(await readFile(join(root, '.github/workflows/usertax.yml'), 'utf8')).toContain(
      'mode: measure',
    );

    const dry = capture();
    await initCommand(['--dry-run', '--single'], dry.io, { cwd: await repo() });
    expect(dry.out.join('')).toContain('--- .github/workflows/usertax.yml');
    expect(dry.out.join('')).not.toContain('usertax-comment.yml');
  });

  it('writes one workflow that comments with --single', async () => {
    const root = await repo();
    await initCommand(['--single'], capture().io, { cwd: root });
    const workflow = parse(await readFile(join(root, '.github/workflows/usertax.yml'), 'utf8')) as {
      permissions: Record<string, string>;
      jobs: { usertax: { steps: { with?: Record<string, unknown> }[] } };
    };
    expect(workflow.permissions['pull-requests']).toBe('write');
    expect(workflow.jobs.usertax.steps.some((s) => s.with?.['mode'] === 'all')).toBe(true);
  });

  it('detects the package manager from the lockfile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-pm-'));
    expect(await detectPackageManager(dir)).toBe('npm');
    await writeFile(join(dir, 'yarn.lock'), '# yarn lockfile v1\n');
    expect(await detectPackageManager(dir)).toBe('yarn-classic');
    await writeFile(join(dir, 'yarn.lock'), '__metadata:\n  version: 8\n');
    expect(await detectPackageManager(dir)).toBe('yarn');
    await writeFile(join(dir, 'bun.lock'), '{}');
    expect(await detectPackageManager(dir)).toBe('bun');
  });

  it.each([
    ['npm', true, ['npm ci', 'npm run build']],
    ['npm', false, ['npm install', 'npm run build']],
    ['yarn', true, ['corepack enable && yarn install --immutable', 'yarn run build']],
    ['yarn-classic', true, ['yarn install --frozen-lockfile', 'yarn build']],
    ['bun', true, ['bun install --frozen-lockfile', 'bun run build']],
  ] as const)('installs and builds with %s (lockfile: %s)', (pm, lockfile, runs) => {
    const workflow = parse(
      measureWorkflow(
        { packageManager: pm, lockfile, hasBuildScript: true, apps: [], defaultBranch: 'main' },
        false,
      ),
    ) as { jobs: { usertax: { steps: { run?: string }[] } } };
    expect(
      workflow.jobs.usertax.steps.flatMap((s) => (s.run === undefined ? [] : [s.run])),
    ).toEqual(runs);
  });

  it('says what to edit without a build script, and budgets web apps by default', () => {
    const text = measureWorkflow(
      {
        packageManager: 'npm',
        lockfile: true,
        hasBuildScript: false,
        apps: [],
        defaultBranch: 'main',
      },
      false,
    );
    expect(text).toContain('# Replace with the command that builds your apps');
    expect(JSON.parse(starterConfig([]))).toMatchObject({
      budgets: [{ metric: 'route[*].js.gzip' }],
    });
  });

  it('needs a package.json, and shows its help', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'usertax-empty-'));
    await expect(initCommand([], capture().io, { cwd: empty })).rejects.toThrow(/no package.json/);
    const c = capture();
    expect(await main(['init', '--help'], c.io)).toBe(0);
    expect(c.out.join('')).toContain('usertax init [options]');
    expect(await main(['init', 'extra'], capture().io)).toBe(2);
  });

  it('notes the source maps that Astro and SvelteKit apps need, until they are configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usertax-notes-'));
    await mkdir(join(root, 'site'));
    await mkdir(join(root, 'kit'));
    const apps = [
      { path: 'site', framework: 'astro' },
      { path: 'kit', framework: 'sveltekit' },
    ] as const;
    expect(await appNotes(root, apps)).toEqual([
      expect.stringContaining("site (Astro): set vite: { build: { sourcemap: 'hidden' } }"),
      expect.stringContaining('kit (SvelteKit): set build.sourcemap'),
    ]);
    await writeFile(
      join(root, 'site', 'astro.config.mjs'),
      "export default { vite: { build: { sourcemap: 'hidden' } } };",
    );
    await writeFile(
      join(root, 'kit', 'vite.config.ts'),
      "export default { build: { sourcemap: 'hidden' } };",
    );
    expect(await appNotes(root, apps)).toEqual([]);
  });

  it('notes what webpack and bare React Native apps need, and falls back to master', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usertax-notes-'));
    const notes = await appNotes(root, [
      { path: '.', framework: 'webpack' },
      { path: 'apps/bare', framework: 'react-native' },
    ]);
    expect(notes).toEqual([
      expect.stringContaining('the root app (webpack): emit source maps'),
      expect.stringContaining('apps/bare (React Native): list its bundles'),
    ]);
    await writeFile(join(root, 'package.json'), '{"name":"one"}');
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/master\n');
    const c = capture();
    await initCommand(['--dry-run'], c.io, { cwd: root });
    expect(c.out.join('')).toContain('branches: [master]');
    expect(c.out.join('')).toContain('No build script in package.json');
  });
});
