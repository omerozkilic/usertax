import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '@usertax/core';
import { discoverApps, loadConfig, workspaceDirs } from '@usertax/measure';

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'usertax-config-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe('loadConfig', () => {
  it('returns undefined without a configuration', async () => {
    expect(await loadConfig(await repo({}))).toBeUndefined();
  });

  it('loads JSON, ES modules and TypeScript in priority order', async () => {
    const json = await repo({
      'usertax.config.json': '{"top": 3}',
      'usertax.config.mjs': 'export default { top: 4 };',
    });
    expect((await loadConfig(json))?.config.top).toBe(3);
    const mjs = await repo({ 'usertax.config.mjs': 'export default { top: 4 };' });
    expect((await loadConfig(mjs))?.config.top).toBe(4);
    const ts = await repo({
      'usertax.config.ts': 'const top: number = 6;\nexport default { top };\n',
    });
    expect((await loadConfig(ts))?.config.top).toBe(6);
  });

  it('loads an explicit file', async () => {
    const root = await repo({ 'config/usertax.json': '{"compression": "brotli"}' });
    const loaded = await loadConfig(root, 'config/usertax.json');
    expect(loaded?.file).toBe(join(root, 'config/usertax.json'));
    expect(loaded?.config.compression).toBe('brotli');
    await expect(loadConfig(root, 'missing.json')).rejects.toThrow(/not found/);
  });

  it('reports broken files', async () => {
    await expect(loadConfig(await repo({ 'usertax.config.json': '{' }))).rejects.toThrow(
      /not valid JSON/,
    );
    await expect(
      loadConfig(await repo({ 'usertax.config.mjs': 'throw new Error("boom");' })),
    ).rejects.toThrow(/cannot load .*boom/);
    await expect(
      loadConfig(await repo({ 'usertax.config.json': '{"tops": 1}' })),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('workspaceDirs and discoverApps', () => {
  const apps = {
    'apps/web/package.json': '{"name":"web","devDependencies":{"vite":"8"}}',
    'apps/site/package.json': '{"name":"site","dependencies":{"next":"16"}}',
    'apps/mobile/package.json':
      '{"name":"mobile","dependencies":{"expo":"58","react-native":"0.88"}}',
    'apps/bare/package.json': '{"name":"bare","dependencies":{"react-native":"0.88"}}',
    'packages/ui/package.json': '{"name":"ui","dependencies":{"react":"19"}}',
    'packages/ui/node_modules/x/package.json': '{"name":"x","dependencies":{"vite":"8"}}',
  };

  it('expands pnpm workspace patterns', async () => {
    const root = await repo({
      ...apps,
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - packages/**\n  - '!packages/ignored'\n",
    });
    expect(await workspaceDirs(root)).toEqual([
      'apps/bare',
      'apps/mobile',
      'apps/site',
      'apps/web',
      'packages/ui',
    ]);
    expect(await discoverApps(root)).toEqual([
      { path: 'apps/bare', framework: 'react-native', name: 'bare' },
      { path: 'apps/mobile', framework: 'expo', name: 'mobile' },
      { path: 'apps/site', framework: 'next', name: 'site' },
      { path: 'apps/web', framework: 'vite', name: 'web' },
    ]);
  });

  it('reads npm and Yarn workspaces, in both forms', async () => {
    const list = await repo({
      ...apps,
      'package.json': '{"workspaces":["apps/web","apps/site/"]}',
    });
    expect(await workspaceDirs(list)).toEqual(['apps/site', 'apps/web']);
    const object = await repo({
      ...apps,
      'package.json': '{"workspaces":{"packages":["apps/*"]}}',
    });
    expect(await workspaceDirs(object)).toHaveLength(4);
  });

  it('falls back to the root package', async () => {
    const single = await repo({ 'package.json': '{"name":"one","devDependencies":{"vite":"8"}}' });
    expect(await discoverApps(single)).toEqual([{ path: '.', framework: 'vite', name: 'one' }]);
    expect(await discoverApps(await repo({ 'package.json': '{}' }))).toEqual([]);
    expect(await discoverApps(await repo({}))).toEqual([]);
  });
});
