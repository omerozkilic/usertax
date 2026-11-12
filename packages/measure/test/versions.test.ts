import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from '@jridgewell/sourcemap-codec';
import { describe, expect, it } from 'vitest';
import {
  attributeBytes,
  installRoot,
  installedVersions,
  packageBytes,
  pnpmVersion,
} from '@usertax/measure';
import type { RawSourceMap } from '@usertax/measure';

/** Two 10-byte segments, one per source: `AAAAAAAAAA` from source 0, `BBBBBBBBBB` from source 1. */
const CODE = 'AAAAAAAAAABBBBBBBBBB';

function twoSources(a: string, b: string): RawSourceMap {
  return {
    version: 3,
    sources: [a, b],
    mappings: encode([
      [
        [0, 0, 0, 0],
        [10, 1, 0, 0],
      ],
    ]),
  };
}

describe('installRoot', () => {
  it.each([
    ['node_modules/lodash/lodash.js', '.', 'lodash', 'node_modules/lodash'],
    ['../../node_modules/lodash/lodash.js', 'dist/assets', 'lodash', 'node_modules/lodash'],
    ['../../node_modules/lodash/x.js', '.', 'lodash', '../../node_modules/lodash'],
    [
      'node_modules/a/node_modules/@scope/pkg/x.js',
      '.',
      '@scope/pkg',
      'node_modules/a/node_modules/@scope/pkg',
    ],
    [
      '../../node_modules/.pnpm/lodash@4.17.20/node_modules/lodash/x.js',
      'dist/assets',
      'lodash',
      'node_modules/.pnpm/lodash@4.17.20/node_modules/lodash',
    ],
    ['webpack://_N_E/./node_modules/lodash/x.js', 'static/chunks', 'lodash', 'node_modules/lodash'],
    ['/work/app/node_modules/lodash/x.js', '.', 'lodash', '/work/app/node_modules/lodash'],
  ])('%s from %s', (source, mapDir, name, root) => {
    expect(installRoot(source, undefined, mapDir)).toEqual({ name, root });
  });

  it('finds nothing for first-party code or a path that is not a package', () => {
    expect(installRoot('../../src/main.ts', undefined, 'dist/assets')).toBeUndefined();
    expect(installRoot('node_modules/.pnpm/x/y.js', undefined, '.')).toBeUndefined();
  });

  it('rejects a root with a backslash, because it is used to find a file', () => {
    expect(installRoot('node_modules/lo\\dash/x.js', undefined, '.')).toBeUndefined();
  });
});

describe('pnpmVersion', () => {
  it.each([
    ['lodash', 'node_modules/.pnpm/lodash@4.17.20/node_modules/lodash', '4.17.20'],
    ['@scope/pkg', 'node_modules/.pnpm/@scope+pkg@1.2.3/node_modules/@scope/pkg', '1.2.3'],
    [
      'react-dom',
      'node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom',
      '19.3.1',
    ],
    ['lodash', '../../node_modules/.pnpm/lodash@4.17.21/node_modules/lodash', '4.17.21'],
  ])('%s', (name, root, version) => {
    expect(pnpmVersion({ name, root })).toBe(version);
  });

  it('knows nothing about other layouts or a folder that is not the package', () => {
    expect(pnpmVersion({ name: 'lodash', root: 'node_modules/lodash' })).toBeUndefined();
    expect(
      pnpmVersion({ name: 'lodash', root: 'node_modules/.pnpm/other@1.0.0/node_modules/lodash' }),
    ).toBeUndefined();
  });
});

describe('versions in attribution', () => {
  it('splits a package that the bundle holds in two versions (pnpm)', () => {
    const map = twoSources(
      '../../node_modules/.pnpm/lodash@4.17.20/node_modules/lodash/lodash.js',
      '../../node_modules/.pnpm/lodash@4.17.21/node_modules/lodash/lodash.js',
    );
    const attribution = attributeBytes(CODE, map, 'dist/assets');
    expect(packageBytes(attribution)).toEqual([
      {
        name: 'lodash',
        bytes: 20,
        versions: [
          { version: '4.17.20', bytes: 10 },
          { version: '4.17.21', bytes: 10 },
        ],
      },
    ]);
  });

  it('reports a package in one version without a split', () => {
    const map = twoSources(
      '../../node_modules/.pnpm/lodash@4.17.20/node_modules/lodash/a.js',
      '../../node_modules/.pnpm/lodash@4.17.20/node_modules/lodash/b.js',
    );
    expect(packageBytes(attributeBytes(CODE, map, 'dist/assets'))).toEqual([
      { name: 'lodash', bytes: 20 },
    ]);
  });

  it('uses the resolver for layouts that do not name the version, and skips unknown copies', () => {
    const map = twoSources(
      '../../node_modules/lodash/lodash.js',
      '../../node_modules/a/node_modules/lodash/lodash.js',
    );
    const known = attributeBytes(CODE, map, 'dist/assets', undefined, ({ root }) =>
      root === 'node_modules/lodash' ? '4.17.21' : '3.10.1',
    );
    expect(known.versions.get('lodash')).toEqual(
      new Map([
        ['4.17.21', 10],
        ['3.10.1', 10],
      ]),
    );
    // One copy has no known version: nothing can be split, so no duplicate is claimed.
    const partial = attributeBytes(CODE, map, 'dist/assets', undefined, ({ root }) =>
      root === 'node_modules/lodash' ? '4.17.21' : undefined,
    );
    expect(partial.versions.size).toBe(0);
    expect(partial.packages.get('lodash')).toBe(20);
  });
});

describe('installedVersions', () => {
  async function install(dir: string, version: string | undefined) {
    await mkdir(dir, { recursive: true });
    if (version !== undefined) {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'lodash', version }));
    }
  }

  it('reads the version of every copy of a package from its package.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'usertax-versions-'));
    const app = join(root, 'apps', 'web');
    await install(join(app, 'node_modules', 'lodash'), '3.10.1'); // the app's own copy
    await install(join(root, 'node_modules', 'lodash'), '4.17.21'); // hoisted above the app
    const map = twoSources('node_modules/lodash/lodash.js', '../../node_modules/lodash/lodash.js');
    const versionOf = await installedVersions(map, '.', app);
    expect(versionOf({ name: 'lodash', root: 'node_modules/lodash' })).toBe('3.10.1');
    expect(versionOf({ name: 'lodash', root: '../../node_modules/lodash' })).toBe('4.17.21');
    const attribution = attributeBytes(CODE, map, '.', undefined, versionOf);
    expect(attribution.versions.get('lodash')).toEqual(
      new Map([
        ['3.10.1', 10],
        ['4.17.21', 10],
      ]),
    );
  });

  it('leaves out copies it cannot read or whose version is not a version', async () => {
    const app = await mkdtemp(join(tmpdir(), 'usertax-versions-'));
    await install(join(app, 'node_modules', 'lodash'), undefined); // no package.json
    await install(join(app, 'node_modules', 'a', 'node_modules', 'lodash'), '<script>alert(1)');
    const map = twoSources(
      'node_modules/lodash/lodash.js',
      'node_modules/a/node_modules/lodash/lodash.js',
    );
    const versionOf = await installedVersions(map, '.', app);
    expect(versionOf({ name: 'lodash', root: 'node_modules/lodash' })).toBeUndefined();
    expect(
      versionOf({ name: 'lodash', root: 'node_modules/a/node_modules/lodash' }),
    ).toBeUndefined();
  });
});
