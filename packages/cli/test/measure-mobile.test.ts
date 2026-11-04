import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseReport } from '@usertax/core';
import { main } from '@usertax/cli';

const fixtures = fileURLToPath(new URL('../../measure/test/fixtures/', import.meta.url));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('usertax measure for React Native and Expo', () => {
  let expo: string;
  let bare: string;
  beforeAll(async () => {
    expo = await mkdtemp(join(tmpdir(), 'usertax-expo-'));
    await writeFile(
      join(expo, 'package.json'),
      '{"dependencies":{"expo":"58","react-native":"0.88"}}',
    );
    for (const platform of ['android', 'ios']) {
      const dir = join(expo, 'dist/_expo/static/js', platform);
      await mkdir(dir, { recursive: true });
      await cp(join(fixtures, 'hermes/index.android.hbc'), join(dir, 'index-1.hbc'));
      await cp(join(fixtures, 'hermes/index.android.hbc.map'), join(dir, 'index-1.hbc.map'));
    }
    bare = await mkdtemp(join(tmpdir(), 'usertax-bare-rn-'));
    await writeFile(join(bare, 'package.json'), '{"dependencies":{"react-native":"0.88"}}');
  });

  it('finds Expo bundles and adds archives', async () => {
    const c = capture();
    const args = [
      'measure',
      expo,
      '--sha',
      'a'.repeat(40),
      '--archive',
      join(fixtures, 'archives/app-release.apk'),
      '--archive',
      `store=${join(fixtures, 'archives/app-release.aab')}`,
    ];
    expect(await main(args, c.io)).toBe(0);
    const app = parseReport(JSON.parse(c.out())).apps[0];
    expect(app).toMatchObject({ kind: 'react-native', framework: 'expo' });
    expect(app?.bundles?.map((b) => [b.platform, b.format])).toEqual([
      ['android', 'hermes'],
      ['ios', 'hermes'],
    ]);
    expect(app?.archives?.map((a) => [a.key, a.format])).toEqual([
      ['android', 'apk'],
      ['store', 'aab'],
    ]);
  });

  it('measures a bare React Native app from explicit bundles', async () => {
    const c = capture();
    const args = [
      'measure',
      bare,
      '--sha',
      'a'.repeat(40),
      '--bundle',
      `android=${join(fixtures, 'hermes/index.android.hbc')}`,
    ];
    expect(await main(args, c.io)).toBe(0);
    const app = parseReport(JSON.parse(c.out())).apps[0];
    expect(app?.framework).toBe('react-native');
    expect(app?.bundles?.[0]?.packages?.[0]?.name).toBe('tiny-pkg');
  });

  it('measures archives alone, and reports unreadable ones as warnings', async () => {
    const c = capture();
    const args = [
      'measure',
      bare,
      '--sha',
      'a'.repeat(40),
      '--archive',
      join(fixtures, 'archives/Example.ipa'),
      '--archive',
      join(fixtures, 'archives/not-a-zip.apk'),
    ];
    expect(await main(args, c.io)).toBe(0);
    expect(c.err()).toContain('not-a-zip.apk: not a ZIP archive');
    expect(parseReport(JSON.parse(c.out())).apps[0]?.archives?.map((a) => a.platform)).toEqual([
      'ios',
    ]);
  });

  it.each([
    [['--bundle', 'windows=x'], '--bundle expects <android|ios>=<file>'],
    [[], 'pass --bundle <android|ios>=<file> and/or --archive <file>'],
    [['--lighthouse', '/'], '--lighthouse is for web apps'],
  ])('rejects %j for a bare app', async (args, expected) => {
    const c = capture();
    expect(await main(['measure', bare, ...args], c.io)).toBe(2);
    expect(c.err()).toContain(expected);
  });

  it('asks for expo export when there is no output', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'usertax-expo-empty-'));
    await writeFile(join(empty, 'package.json'), '{"dependencies":{"expo":"58"}}');
    const c = capture();
    expect(await main(['measure', empty], c.io)).toBe(2);
    expect(c.err()).toContain('run expo export --source-maps first');
  });

  it('rejects mobile flags for web apps', async () => {
    const web = await mkdtemp(join(tmpdir(), 'usertax-web-'));
    await writeFile(join(web, 'package.json'), '{"devDependencies":{"vite":"8"}}');
    const c = capture();
    expect(await main(['measure', web, '--archive', 'x.apk'], c.io)).toBe(2);
    expect(c.err()).toContain('--bundle and --archive are for React Native and Expo apps');
  });
});
