import type { Dependency } from '@usertax/core';

/** A resolved package (or workspace) in a lockfile. */
export interface LockNode {
  readonly name: string;
  readonly version: string;
  /** Set for workspace packages; their code is first-party. */
  readonly workspace?: string;
  /** Child node ids. */
  readonly deps: readonly string[];
}

/** A direct dependency of an importer: the name it is declared under and the node it resolves to. */
export interface DirectDependency {
  readonly name: string;
  readonly id: string;
}

export interface Importer {
  readonly prod: readonly DirectDependency[];
  readonly dev: readonly DirectDependency[];
}

/** A lockfile reduced to a graph: importers (workspace paths) and resolved nodes. */
export interface LockGraph {
  readonly format: 'pnpm' | 'npm' | 'yarn-classic' | 'yarn-berry' | 'bun';
  readonly importers: ReadonlyMap<string, Importer>;
  readonly nodes: ReadonlyMap<string, LockNode>;
}

export class LockfileError extends Error {
  override readonly name = 'LockfileError';
}

const MAX_VIA = 3;
/** A longer chain is not shown; the schema allows ten names. */
const MAX_CHAIN = 10;

/** The shorter chain wins; equal lengths are ordered by name so the result is stable. */
function shorter(candidate: readonly string[], current: readonly string[] | undefined): boolean {
  if (current === undefined) return true;
  if (candidate.length !== current.length) return candidate.length < current.length;
  return candidate.join('\0') < current.join('\0');
}

interface Acc {
  name: string;
  version: string;
  direct: boolean;
  prod: boolean;
  via: Set<string>;
  /** The shortest path from a direct dependency to the package that depends on this one. */
  chain?: readonly string[];
}

/**
 * Every package reachable from one importer, with whether it is a direct dependency, whether it
 * is reachable from production dependencies, up to three direct dependencies (or workspace
 * packages) that pull it in and, when it is more than one step away from them, the shortest chain
 * of packages that leads to it. Workspace packages are traversed but not listed.
 */
export function dependenciesOf(graph: LockGraph, importerPath: string): Dependency[] {
  const importer = graph.importers.get(importerPath);
  if (importer === undefined) {
    throw new LockfileError(`the lockfile has no entry for "${importerPath}"`);
  }
  const found = new Map<string, Acc>();
  const walk = (start: string, root: string, prod: boolean) => {
    // `path` holds the packages from the direct dependency down to the parent of the node.
    const queue: { id: string; depth: number; path: readonly string[] }[] = [
      { id: start, depth: 0, path: [] },
    ];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const item = queue.shift() as { id: string; depth: number; path: readonly string[] };
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const node = graph.nodes.get(item.id);
      if (node === undefined) continue;
      if (node.workspace === undefined) {
        const key = `${node.name}@${node.version}`;
        const acc = found.get(key) ?? {
          name: node.name,
          version: node.version,
          direct: false,
          prod: false,
          via: new Set(),
        };
        if (item.depth === 0) acc.direct = true;
        else {
          if (acc.via.size < MAX_VIA) acc.via.add(root);
          if (shorter(item.path, acc.chain)) acc.chain = item.path;
        }
        if (prod) acc.prod = true;
        found.set(key, acc);
      }
      const path = item.depth === 0 ? [root] : [...item.path, node.name];
      for (const child of node.deps) queue.push({ id: child, depth: item.depth + 1, path });
    }
  };
  for (const dep of importer.prod) walk(dep.id, dep.name, true);
  for (const dep of importer.dev) walk(dep.id, dep.name, false);
  return [...found.values()]
    .map((acc) => ({
      name: acc.name,
      version: acc.version,
      direct: acc.direct,
      ...(acc.prod ? {} : { dev: true }),
      ...(acc.direct || acc.via.size === 0 ? {} : { via: [...acc.via].sort() }),
      ...(!acc.direct &&
      acc.chain !== undefined &&
      acc.chain.length > 1 &&
      acc.chain.length <= MAX_CHAIN
        ? { chain: [...acc.chain] }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
