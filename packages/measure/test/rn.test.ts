import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  attributeHermes,
  findExpoBundles,
  measureBundle,
  measureRnApp,
  parseSourceMap,
} from '@usertax/measure';

const hermesDir = fileURLToPath(new URL('./fixtures/hermes/', import.meta.url));
const archives = fileURLToPath(new URL('./fixtures/archives/', import.meta.url));

describe('attributeHermes', () => {
  it('attributes real Hermes bytecode to its modules, accounting for every byte', async () => {
    const hbc = await readFile(join(hermesDir, 'index.android.hbc'));
    const map = parseSourceMap(await readFile(join(hermesDir, 'index.android.hbc.map'), 'utf8'));
    const result = attributeHermes(hbc.byteLength, map);
    expect([...result.packages.keys()]).toEqual(['tiny-pkg']);
    expect(result.firstPartyBytes).toBeGreaterThan(0);
    const packageBytes = [...result.packages.values()].reduce((a, b) => a + b, 0);
    expect(packageBytes + result.firstPartyBytes + result.unattributedBytes).toBe(hbc.byteLength);
    expect(result.modules.map((m) => m.path).sort()).toEqual([
      'node_modules/tiny-pkg/index.js',
      'src/App.js',
    ]);
  });

  it('clamps segments to the file size and skips unmapped segments', () => {
    const map = {
      version: 3,
      sources: ['a.js', null as unknown as string],
      mappings: 'AAAA,UAAU,UCAA,U',
    };
    // segments at 0 (a.js), 10 (a.js), 20 (null source), 30 (no source)
    const result = attributeHermes(25, map);
    expect(result.firstPartyBytes).toBe(20);
    expect(result.unattributedBytes).toBe(5);
  });
});

describe('measureBundle', () => {
  it('measures Hermes bundles without compressed sizes', async () => {
    const { bundle, warnings } = await measureBundle(
      { platform: 'android', file: join(hermesDir, 'index.android.hbc') },
      hermesDir,
    );
    expect(warnings).toEqual([]);
    expect(bundle).toMatchObject({
      platform: 'android',
      format: 'hermes',
      file: 'index.android.hbc',
    });
    expect(bundle).not.toHaveProperty('gzip');
    expect(bundle.packages?.[0]?.name).toBe('tiny-pkg');
  });

  it('measures JavaScript bundles with compressed sizes and source-map attribution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-rn-'));
    await writeFile(join(dir, 'main.jsbundle'), 'var a=1;');
    await writeFile(
      join(dir, 'main.jsbundle.map'),
      JSON.stringify({ version: 3, sources: ['node_modules/x/i.js'], mappings: 'AAAA' }),
    );
    const { bundle } = await measureBundle(
      { platform: 'ios', file: join(dir, 'main.jsbundle') },
      dir,
    );
    expect(bundle).toMatchObject({ format: 'js', raw: 8, packages: [{ name: 'x', bytes: 8 }] });
    expect(bundle.gzip).toBeGreaterThan(0);
  });

  it('warns about missing or broken maps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-rn-'));
    await writeFile(join(dir, 'a.bundle'), 'x');
    await writeFile(join(dir, 'b.bundle'), 'x');
    await writeFile(join(dir, 'b.map'), '{');
    expect(
      (await measureBundle({ platform: 'ios', file: join(dir, 'a.bundle') }, dir)).warnings[0]
        ?.message,
    ).toMatch(/no source map/);
    expect(
      (
        await measureBundle(
          { platform: 'ios', file: join(dir, 'b.bundle'), map: join(dir, 'b.map') },
          dir,
        )
      ).warnings[0]?.message,
    ).toMatch(/source map ignored/);
  });
});

describe('findExpoBundles', () => {
  it('finds the bundles of an expo export', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'usertax-expo-'));
    for (const platform of ['android', 'ios']) {
      await mkdir(join(dist, '_expo/static/js', platform), { recursive: true });
      await cp(
        join(hermesDir, 'index.android.hbc'),
        join(dist, '_expo/static/js', platform, `index-abc.hbc`),
      );
      await writeFile(join(dist, '_expo/static/js', platform, 'index-abc.hbc.map'), '{}');
    }
    const found = await findExpoBundles(dist);
    expect(found.map((b) => [b.platform, b.file.endsWith('index-abc.hbc')])).toEqual([
      ['android', true],
      ['ios', true],
    ]);
    expect(await findExpoBundles(join(dist, 'missing'))).toEqual([]);
  });
});

describe('measureRnApp', () => {
  it('combines bundles and archives and reports unreadable archives as warnings', async () => {
    const { app, warnings } = await measureRnApp({
      id: 'mobile',
      name: 'mobile',
      appDir: hermesDir,
      path: 'apps/mobile',
      framework: 'expo',
      bundles: [{ platform: 'android', file: join(hermesDir, 'index.android.hbc') }],
      archives: [
        { file: join(archives, 'app-release.apk') },
        { file: join(archives, 'Example.ipa'), key: 'ios-release' },
        { file: join(archives, 'not-a-zip.apk') },
      ],
      dependencies: [{ name: 'tiny-pkg', version: '1.0.0', direct: true }],
    });
    expect(app).toMatchObject({ kind: 'react-native', framework: 'expo' });
    expect(app.bundles).toHaveLength(1);
    expect(app.archives?.map((a) => a.key)).toEqual(['android', 'ios-release']);
    expect(app.dependencies).toHaveLength(1);
    expect(warnings).toEqual([
      {
        file: join(archives, 'not-a-zip.apk'),
        message: 'not a ZIP archive (no end of central directory record)',
      },
    ]);
  });

  it('omits empty sections', async () => {
    const { app } = await measureRnApp({
      id: 'm',
      name: 'm',
      appDir: '.',
      path: '.',
      framework: 'react-native',
      bundles: [],
      archives: [],
    });
    expect(app).not.toHaveProperty('bundles');
    expect(app).not.toHaveProperty('archives');
  });
});
