import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureExpoUpdates, measureRnApp } from '@usertax/measure';

const fixture = fileURLToPath(new URL('./fixtures/expo-update/', import.meta.url));

/** A directory with a `metadata.json` and the given files (sizes in bytes). */
async function exportDir(metadata: unknown, files: Record<string, number> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'usertax-expo-update-'));
  await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata));
  for (const [path, size] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), Buffer.alloc(size));
  }
  return dir;
}

const meta = (fileMetadata: unknown) => ({ version: 0, bundler: 'metro', fileMetadata });

describe('measureExpoUpdates', () => {
  it('sums the bundle and the assets that metadata.json lists, per platform', async () => {
    const { updates, warnings } = await measureExpoUpdates(fixture);
    expect(warnings).toEqual([]);
    expect(updates.map((u) => ({ ...u, file: undefined }))).toEqual([
      { platform: 'android', file: undefined, bundleBytes: 636, assetCount: 1, assetBytes: 11_827 },
      { platform: 'ios', file: undefined, bundleBytes: 736, assetCount: 1, assetBytes: 11_827 },
    ]);
    expect(updates.map((u) => u.file)).toEqual([
      expect.stringMatching(/^_expo\/static\/js\/android\/index-[0-9a-f]{32}\.hbc$/) as string,
      expect.stringMatching(/^_expo\/static\/js\/ios\/index-[0-9a-f]{32}\.hbc$/) as string,
    ]);
  });

  it('does not count source maps or files metadata.json does not list', async () => {
    const dir = await exportDir(meta({ android: { bundle: 'b.hbc', assets: [] } }), {
      'b.hbc': 100,
      'b.hbc.map': 5000,
      'assets/unlisted': 777,
    });
    const { updates } = await measureExpoUpdates(dir);
    expect(updates).toMatchObject([{ platform: 'android', bundleBytes: 100, assetBytes: 0 }]);
  });

  it('counts an asset listed twice once', async () => {
    const dir = await exportDir(
      meta({
        ios: {
          bundle: 'b.hbc',
          assets: [
            { path: 'assets/a', ext: 'png' },
            { path: 'assets/a', ext: 'png' },
          ],
        },
      }),
      { 'b.hbc': 10, 'assets/a': 30 },
    );
    expect((await measureExpoUpdates(dir)).updates).toMatchObject([
      { platform: 'ios', assetCount: 1, assetBytes: 30 },
    ]);
  });

  it('gives nothing, quietly, for a directory that is not an Expo export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-expo-update-'));
    expect(await measureExpoUpdates(dir)).toEqual({ updates: [], warnings: [] });
    expect(await measureExpoUpdates(join(dir, 'missing'))).toEqual({ updates: [], warnings: [] });
  });

  it('warns about metadata.json it cannot use', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'usertax-expo-update-'));
    await writeFile(join(broken, 'metadata.json'), '{');
    expect((await measureExpoUpdates(broken)).warnings[0]?.message).toMatch(/not valid JSON/);
    for (const metadata of [[], { fileMetadata: [] }, { version: 0 }, null]) {
      const dir = await exportDir(metadata);
      const result = await measureExpoUpdates(dir);
      expect(result.updates).toEqual([]);
      expect(result.warnings[0]?.message).toMatch(/no fileMetadata/);
    }
    const noBundle = await exportDir(meta({ android: { assets: [] }, ios: 'nope' }));
    const result = await measureExpoUpdates(noBundle);
    expect(result.updates).toEqual([]);
    expect(result.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/no bundle for android/),
      expect.stringMatching(/no bundle for ios/),
    ]);
  });

  it('skips a platform whose bundle is missing and does not count missing assets', async () => {
    const dir = await exportDir(
      meta({
        android: { bundle: 'gone.hbc', assets: [] },
        ios: {
          bundle: 'b.hbc',
          assets: [{ path: 'assets/gone', ext: 'png' }, { path: 'assets/a' }, { ext: 'png' }],
        },
      }),
      { 'b.hbc': 10, 'assets/a': 5 },
    );
    const { updates, warnings } = await measureExpoUpdates(dir);
    expect(updates).toMatchObject([{ platform: 'ios', assetCount: 1, assetBytes: 5 }]);
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/missing; android update size skipped/),
      expect.stringMatching(/missing; not counted/),
    ]);
  });

  it('refuses paths outside the export directory, directories and symlinks', async () => {
    const dir = await exportDir(
      meta({
        android: { bundle: '../outside.hbc', assets: [] },
        ios: {
          bundle: 'b.hbc',
          assets: [
            { path: '/etc/hosts', ext: '' },
            { path: 'assets', ext: '' },
            { path: 'link', ext: '' },
            { path: 'assets/../../up', ext: '' },
          ],
        },
      }),
      { 'b.hbc': 10, 'assets/inside': 1 },
    );
    await symlink('/etc/hosts', join(dir, 'link'));
    const { updates, warnings } = await measureExpoUpdates(dir);
    expect(updates).toMatchObject([{ platform: 'ios', assetCount: 0, assetBytes: 0 }]);
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/outside the export directory; android update size skipped/),
      expect.stringMatching(/outside the export directory; not counted/),
      expect.stringMatching(/not a regular file; not counted/),
      expect.stringMatching(/not a regular file; not counted/),
      expect.stringMatching(/outside the export directory; not counted/),
    ]);
  });
});

describe('measureRnApp with an update directory', () => {
  const common = {
    id: 'mobile',
    name: 'mobile',
    appDir: fixture,
    path: 'apps/mobile',
    framework: 'expo',
    bundles: [],
    archives: [],
  } as const;

  it('adds the updates to the app', async () => {
    const { app } = await measureRnApp({ ...common, updateDir: fixture });
    expect(app.updates?.map((u) => u.platform)).toEqual(['android', 'ios']);
  });

  it('leaves the app unchanged without an update directory or without updates', async () => {
    expect((await measureRnApp(common)).app).not.toHaveProperty('updates');
    const empty = await mkdtemp(join(tmpdir(), 'usertax-expo-update-'));
    expect((await measureRnApp({ ...common, updateDir: empty })).app).not.toHaveProperty('updates');
  });
});
