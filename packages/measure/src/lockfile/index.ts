import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Dependency } from '@usertax/core';
import { readPackageJson } from '../detect.js';
import { LockfileError, dependenciesOf } from './graph.js';
import type { LockGraph } from './graph.js';
import { parseNpmLock } from './npm.js';
import { parsePnpmLock } from './pnpm.js';
import { parseYarnLock } from './yarn.js';
import type { YarnWorkspace } from './yarn.js';

export { LockfileError, dependenciesOf } from './graph.js';
export type { DirectDependency, Importer, LockGraph, LockNode } from './graph.js';
export { parseNpmLock } from './npm.js';
export { parsePnpmLock } from './pnpm.js';
export { parseYarnLock } from './yarn.js';
export type { YarnWorkspace } from './yarn.js';

const LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
] as const;

export interface LockfileLocation {
  readonly path: string;
  readonly name: (typeof LOCKFILES)[number];
}

/** Finds the nearest lockfile in `startDir` or its ancestors, not above `stopDir`. */
export async function findLockfile(
  startDir: string,
  stopDir?: string,
): Promise<LockfileLocation | undefined> {
  let dir = resolve(startDir);
  const stop = stopDir === undefined ? undefined : resolve(stopDir);
  for (;;) {
    const names = new Set(await readdir(dir).catch(() => [] as string[]));
    const name = LOCKFILES.find((candidate) => names.has(candidate));
    if (name !== undefined) return { path: join(dir, name), name };
    const parent = dirname(dir);
    if (parent === dir || dir === stop) return undefined;
    dir = parent;
  }
}

/** Expands workspace patterns of the form `dir`, `dir/*` (one level). */
async function expandWorkspaces(root: string, patterns: readonly string[]): Promise<string[]> {
  const result = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      const entries = await readdir(join(root, base), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) if (entry.isDirectory()) result.add(`${base}/${entry.name}`);
    } else if (!pattern.includes('*')) {
      result.add(pattern.replace(/\/$/, ''));
    }
  }
  return [...result].sort();
}

async function yarnWorkspaces(root: string): Promise<YarnWorkspace[]> {
  const manifest = await readPackageJson(root);
  if (manifest === undefined)
    throw new LockfileError(`no package.json next to ${join(root, 'yarn.lock')}`);
  const declared = manifest.workspaces;
  const patterns: readonly string[] =
    declared === undefined
      ? []
      : 'packages' in declared
        ? (declared.packages ?? [])
        : (declared as readonly string[]);
  const workspaces: YarnWorkspace[] = [{ path: '.', manifest }];
  for (const path of await expandWorkspaces(root, patterns)) {
    const child = await readPackageJson(join(root, path));
    if (child !== undefined) workspaces.push({ path, manifest: child });
  }
  return workspaces;
}

/** Parses a lockfile into a graph. */
export async function readLockGraph(location: LockfileLocation): Promise<LockGraph> {
  const text = await readFile(location.path, 'utf8');
  switch (location.name) {
    case 'pnpm-lock.yaml':
      return parsePnpmLock(text);
    case 'package-lock.json':
    case 'npm-shrinkwrap.json':
      return parseNpmLock(text);
    case 'yarn.lock':
      return parseYarnLock(text, await yarnWorkspaces(dirname(location.path)));
  }
}

export interface AppDependencies {
  readonly lockfile: LockfileLocation;
  readonly format: LockGraph['format'];
  readonly dependencies: Dependency[];
}

/**
 * Resolved dependencies of the app in `appDir` according to the nearest lockfile. Returns
 * undefined when there is no lockfile. Throws {@link LockfileError} for unreadable lockfiles.
 */
export async function readAppDependencies(
  appDir: string,
  stopDir?: string,
): Promise<AppDependencies | undefined> {
  const lockfile = await findLockfile(appDir, stopDir);
  if (lockfile === undefined) return undefined;
  const graph = await readLockGraph(lockfile);
  const importer = relative(dirname(lockfile.path), resolve(appDir)).split(sep).join('/') || '.';
  return { lockfile, format: graph.format, dependencies: dependenciesOf(graph, importer) };
}
