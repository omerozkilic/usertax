import { LockfileError } from './graph.js';
import type { Importer, LockGraph, LockNode } from './graph.js';

interface NpmEntry {
  name?: string;
  version?: string;
  link?: boolean;
  resolved?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NpmLock {
  lockfileVersion?: number;
  packages?: Record<string, NpmEntry>;
}

const MARKER = 'node_modules/';

function nameFromLocation(location: string): string {
  const index = location.lastIndexOf(MARKER);
  return index === -1 ? location : location.slice(index + MARKER.length);
}

/** Node's resolution: `<dir>/node_modules/<name>` for `dir` and each ancestor of it. */
function resolve(
  packages: Record<string, NpmEntry>,
  from: string,
  name: string,
): string | undefined {
  const segments = from === '' ? [] : from.split('/');
  for (let length = segments.length; length >= 0; length -= 1) {
    if (length > 0 && segments[length - 1] === 'node_modules') continue;
    const prefix = segments.slice(0, length).join('/');
    const candidate = prefix === '' ? `${MARKER}${name}` : `${prefix}/${MARKER}${name}`;
    if (candidate in packages) return candidate;
  }
  return undefined;
}

/** Parses `package-lock.json` / `npm-shrinkwrap.json` (lockfile versions 2 and 3). */
export function parseNpmLock(text: string): LockGraph {
  let lock: NpmLock;
  try {
    lock = JSON.parse(text) as NpmLock;
  } catch {
    throw new LockfileError('package-lock.json is not valid JSON');
  }
  if (lock.packages === undefined || (lock.lockfileVersion ?? 0) < 2) {
    throw new LockfileError(
      'unsupported package-lock.json: lockfile version 2 or 3 is required (npm 7+)',
    );
  }
  const packages = lock.packages;
  const nodes = new Map<string, LockNode>();
  const importers = new Map<string, Importer>();
  const target = (location: string): string => {
    const entry = packages[location];
    return entry?.link === true && entry.resolved !== undefined ? entry.resolved : location;
  };

  for (const [location, entry] of Object.entries(packages)) {
    if (entry.link === true) continue;
    const runtime = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    const deps = Object.keys(runtime)
      .map((name) => resolve(packages, location, name))
      .filter((id): id is string => id !== undefined)
      .map(target);
    const isWorkspace = !location.includes(MARKER);
    const path = location === '' ? '.' : location;
    nodes.set(location, {
      name: entry.name ?? nameFromLocation(location),
      version: entry.version ?? '0.0.0',
      ...(isWorkspace ? { workspace: path } : {}),
      deps,
    });
    if (isWorkspace) {
      const list = (record: Record<string, string> | undefined) =>
        Object.keys(record ?? {}).flatMap((name) => {
          const id = resolve(packages, location, name);
          return id === undefined ? [] : [{ name, id: target(id) }];
        });
      importers.set(path, {
        prod: list({ ...entry.dependencies, ...entry.optionalDependencies }),
        dev: list(entry.devDependencies),
      });
    }
  }
  return { format: 'npm', importers, nodes };
}
