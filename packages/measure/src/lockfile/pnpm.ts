import { posix } from 'node:path';
import { parse } from 'yaml';
import { LockfileError } from './graph.js';
import type { Importer, LockGraph, LockNode } from './graph.js';

interface ImporterDeps {
  dependencies?: Record<string, { version: string }>;
  devDependencies?: Record<string, { version: string }>;
  optionalDependencies?: Record<string, { version: string }>;
}

interface Snapshot {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PnpmLock {
  lockfileVersion?: string | number;
  importers?: Record<string, ImporterDeps>;
  packages?: Record<string, Snapshot>;
  snapshots?: Record<string, Snapshot>;
}

/** `19.3.1(react@19.3.1)` → `19.3.1`. */
function stripPeers(version: string): string {
  const paren = version.indexOf('(');
  return paren === -1 ? version : version.slice(0, paren);
}

/** Splits `react-dom@19.3.1(react@19.3.1)` or `@scope/pkg@1.0.0` into name and version. */
function splitKey(key: string): { name: string; version: string } {
  const clean = key.startsWith('/') ? key.slice(1) : key;
  const base = stripPeers(clean);
  const at = base.lastIndexOf('@');
  if (at <= 0) throw new LockfileError(`unexpected pnpm package key "${key}"`);
  return { name: base.slice(0, at), version: base.slice(at + 1) };
}

/**
 * Parses `pnpm-lock.yaml` (lockfile versions 6 and 9). In v9 the dependency graph lives in
 * `snapshots`; in v6 in `packages`, with keys prefixed by `/`.
 */
export function parsePnpmLock(text: string): LockGraph {
  const lock = parse(text) as PnpmLock | null;
  const version = Number.parseFloat(String(lock?.lockfileVersion ?? ''));
  if (lock === null || !(version >= 6 && version < 10)) {
    throw new LockfileError(
      `unsupported pnpm lockfile version "${String(lock?.lockfileVersion)}" (6.x and 9.x are supported)`,
    );
  }
  const v9 = version >= 9;
  const graphSource = (v9 ? lock.snapshots : lock.packages) ?? {};
  const prefix = v9 ? '' : '/';
  const nodes = new Map<string, LockNode>();

  const ref = (name: string, versionRef: string, from: string): string => {
    if (versionRef.startsWith('link:')) {
      return `workspace:${posix.normalize(posix.join(from, versionRef.slice(5)))}`;
    }
    // Aliases resolve to `<target>@<version>` instead of a bare version.
    const looksAliased = stripPeers(versionRef).slice(1).includes('@');
    return looksAliased ? `${prefix}${versionRef}` : `${prefix}${name}@${versionRef}`;
  };

  for (const [key, snapshot] of Object.entries(graphSource)) {
    const { name, version: resolved } = splitKey(key);
    const deps = Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies }).map(
      ([dep, v]) => ref(dep, v, '.'),
    );
    nodes.set(key, { name, version: resolved, deps });
  }

  const importers = new Map<string, Importer>();
  for (const [path, deps] of Object.entries(lock.importers ?? {})) {
    const list = (record: Record<string, { version: string }> | undefined) =>
      Object.entries(record ?? {}).map(([name, value]) => ({
        name,
        id: ref(name, value.version, path),
      }));
    const prod = [...list(deps.dependencies), ...list(deps.optionalDependencies)];
    const dev = list(deps.devDependencies);
    importers.set(path, { prod, dev });
    nodes.set(`workspace:${posix.normalize(path)}`, {
      name: path,
      version: '0.0.0',
      workspace: path,
      deps: prod.map((dep) => dep.id),
    });
  }
  return { format: 'pnpm', importers, nodes };
}
