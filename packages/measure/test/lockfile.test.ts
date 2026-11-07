import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LockfileError,
  dependenciesOf,
  findLockfile,
  parseBunLock,
  parseNpmLock,
  parsePnpmLock,
  parseYarnLock,
  readAppDependencies,
  readLockGraph,
} from '@usertax/measure';

const fixtures = fileURLToPath(new URL('./fixtures/lockfiles/', import.meta.url));

/** What every package manager must agree on for packages/web of the fixture workspace. */
const WEB = [
  { name: 'is-number', version: '7.0.0', direct: true, dev: true },
  { name: 'moment', version: '2.30.1', direct: false, via: ['lib'] },
  { name: 'react', version: '19.3.1', direct: true },
  { name: 'react-dom', version: '19.3.1', direct: true },
  { name: 'scheduler', version: '0.28.0', direct: false, via: ['react-dom'] },
];

describe.each([
  ['pnpm', 'pnpm'],
  ['npm', 'npm'],
  ['yarn1', 'yarn-classic'],
  ['berry', 'yarn-berry'],
  ['bun', 'bun'],
])('%s lockfile', (dir, format) => {
  it('resolves the dependencies of a workspace app, through workspace links', async () => {
    const result = await readAppDependencies(
      join(fixtures, dir, 'packages/web'),
      join(fixtures, dir),
    );
    expect(result?.format).toBe(format);
    expect(result?.dependencies).toEqual(WEB);
  });

  it('resolves the root importer', async () => {
    const result = await readAppDependencies(join(fixtures, dir), join(fixtures, dir));
    expect(result?.dependencies).toEqual([{ name: 'ms', version: '2.1.3', direct: true }]);
  });
});

describe('findLockfile', () => {
  it('stops at the stop directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-lock-'));
    await mkdir(join(dir, 'a', 'b'), { recursive: true });
    expect(await findLockfile(join(dir, 'a', 'b'), join(dir, 'a'))).toBeUndefined();
    expect(await readAppDependencies(join(dir, 'a', 'b'), join(dir, 'a'))).toBeUndefined();
    await writeFile(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    expect((await findLockfile(join(dir, 'a', 'b')))?.name).toBe('pnpm-lock.yaml');
  });
});

describe('dependenciesOf', () => {
  it('rejects unknown importers', () => {
    const graph = parsePnpmLock("lockfileVersion: '9.0'\nimporters:\n  .: {}\n");
    expect(() => dependenciesOf(graph, 'apps/missing')).toThrow(/no entry for "apps\/missing"/);
  });

  it('caps via at three entries', () => {
    const graph = parsePnpmLock(`lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      a: { specifier: '1', version: 1.0.0 }
      b: { specifier: '1', version: 1.0.0 }
      c: { specifier: '1', version: 1.0.0 }
      d: { specifier: '1', version: 1.0.0 }
snapshots:
  a@1.0.0: { dependencies: { shared: 1.0.0 } }
  b@1.0.0: { dependencies: { shared: 1.0.0 } }
  c@1.0.0: { dependencies: { shared: 1.0.0 } }
  d@1.0.0: { dependencies: { shared: 1.0.0 } }
  shared@1.0.0: {}
`);
    expect(dependenciesOf(graph, '.').find((d) => d.name === 'shared')?.via).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('parsePnpmLock', () => {
  it('reads v6 lockfiles, aliases and scoped packages', () => {
    const graph = parsePnpmLock(`lockfileVersion: '6.0'
importers:
  .:
    dependencies:
      '@scope/pkg': { specifier: ^1.0.0, version: 1.2.0 }
      cjs: { specifier: npm:string-width@4.2.3, version: string-width@4.2.3 }
packages:
  /@scope/pkg@1.2.0: { dependencies: { tslib: 2.8.1 } }
  /string-width@4.2.3: {}
  /tslib@2.8.1: {}
`);
    expect(dependenciesOf(graph, '.')).toEqual([
      { name: '@scope/pkg', version: '1.2.0', direct: true },
      { name: 'string-width', version: '4.2.3', direct: true },
      { name: 'tslib', version: '2.8.1', direct: false, via: ['@scope/pkg'] },
    ]);
  });

  it('rejects unsupported versions and malformed keys', () => {
    expect(() => parsePnpmLock("lockfileVersion: '5.4'\n")).toThrow(
      /unsupported pnpm lockfile version/,
    );
    expect(() => parsePnpmLock('')).toThrow(LockfileError);
    expect(() => parsePnpmLock("lockfileVersion: '9.0'\nsnapshots:\n  nonsense: {}\n")).toThrow(
      /unexpected pnpm package key/,
    );
  });
});

describe('parseNpmLock', () => {
  it('resolves nested node_modules before hoisted ones', () => {
    const graph = parseNpmLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { a: '1', b: '1' } },
          'node_modules/a': { version: '1.0.0', dependencies: { c: '2' } },
          'node_modules/a/node_modules/c': { version: '2.0.0' },
          'node_modules/b': { version: '1.0.0', dependencies: { c: '1' } },
          'node_modules/c': { version: '1.0.0' },
        },
      }),
    );
    expect(dependenciesOf(graph, '.')).toEqual([
      { name: 'a', version: '1.0.0', direct: true },
      { name: 'b', version: '1.0.0', direct: true },
      { name: 'c', version: '1.0.0', direct: false, via: ['b'] },
      { name: 'c', version: '2.0.0', direct: false, via: ['a'] },
    ]);
  });

  it('rejects old and invalid lockfiles', () => {
    expect(() => parseNpmLock('{')).toThrow(/not valid JSON/);
    expect(() => parseNpmLock('{"lockfileVersion":1,"dependencies":{}}')).toThrow(/version 2 or 3/);
  });
});

describe('parseYarnLock', () => {
  it('rejects indented content before the first entry', () => {
    expect(() => parseYarnLock('  version "1.0.0"\n', [])).toThrow(/malformed yarn.lock/);
  });

  it('reads quoted, multi-descriptor classic entries', () => {
    const graph = parseYarnLock(
      '"@scope/a@^1.0.0", "@scope/a@^1.1.0":\n  version "1.2.0"\n  dependencies:\n    b "^2.0.0"\n\nb@^2.0.0:\n  version "2.1.0"\n',
      [{ path: '.', manifest: { dependencies: { '@scope/a': '^1.1.0' } } }],
    );
    expect(dependenciesOf(graph, '.')).toEqual([
      { name: '@scope/a', version: '1.2.0', direct: true },
      { name: 'b', version: '2.1.0', direct: false, via: ['@scope/a'] },
    ]);
  });
});

describe('parseBunLock', () => {
  it('resolves nested and scoped packages before hoisted ones', async () => {
    const result = await readAppDependencies(join(fixtures, 'bun-nested'));
    expect(result?.format).toBe('bun');
    expect(result?.dependencies).toEqual([
      { name: '@nodelib/fs.scandir', version: '2.1.5', direct: true },
      { name: '@nodelib/fs.stat', version: '1.1.3', direct: true },
      { name: '@nodelib/fs.stat', version: '2.0.5', direct: false, via: ['@nodelib/fs.scandir'] },
      { name: 'debug', version: '4.4.3', direct: true },
      { name: 'ms', version: '2.0.0', direct: true },
      { name: 'ms', version: '2.1.3', direct: false, via: ['debug'] },
      { name: 'queue-microtask', version: '1.2.3', direct: false, via: ['@nodelib/fs.scandir'] },
      { name: 'run-parallel', version: '1.2.0', direct: false, via: ['@nodelib/fs.scandir'] },
    ]);
  });

  it('prefers a version nested under a workspace', () => {
    const graph = parseBunLock(`{
      "lockfileVersion": 1,
      "workspaces": {
        "": { "name": "root", "dependencies": { "a": "1" } },
        "apps/web": { "name": "web", "dependencies": { "a": "2" } },
      },
      "packages": {
        "a": ["a@1.0.0", "", {}, "sha512-"],
        "web": ["web@workspace:apps/web"],
        "web/a": ["a@2.0.0", "", {}, "sha512-"],
      },
    }`);
    expect(dependenciesOf(graph, '.')).toEqual([{ name: 'a', version: '1.0.0', direct: true }]);
    expect(dependenciesOf(graph, 'apps/web')).toEqual([
      { name: 'a', version: '2.0.0', direct: true },
    ]);
  });

  it('keeps commas and brackets inside strings', () => {
    const graph = parseBunLock(
      '{"workspaces":{"":{"name":"x, ]","dependencies":{"a":"1",},},},' +
        '"packages":{"a":["a@1.0.0","",{},"\\\\\\",}"],},}',
    );
    expect(graph.nodes.get('workspace:')?.name).toBe('x, ]');
    expect(dependenciesOf(graph, '.')).toEqual([{ name: 'a', version: '1.0.0', direct: true }]);
  });

  it('rejects invalid and unsupported lockfiles', async () => {
    expect(() => parseBunLock('{')).toThrow(/not valid JSON/);
    expect(() => parseBunLock('{"lockfileVersion": 1}')).toThrow(/"workspaces" and "packages"/);
    await expect(readLockGraph({ path: '/repo/bun.lockb', name: 'bun.lockb' })).rejects.toThrow(
      /bun install --save-text-lockfile/,
    );
  });
});
