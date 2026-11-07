import { LockfileError } from './graph.js';
import type { DirectDependency, Importer, LockGraph, LockNode } from './graph.js';

type Deps = Record<string, string>;

interface BunWorkspace {
  name?: string;
  version?: string;
  dependencies?: Deps;
  devDependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
}

interface BunInfo {
  dependencies?: Deps;
  optionalDependencies?: Deps;
  peerDependencies?: Deps;
}

interface BunLock {
  lockfileVersion?: number;
  workspaces?: Record<string, BunWorkspace>;
  /** Key: node_modules-like path (`dep`, `parent/dep`, `@scope/a/@scope/b`); value: an array
   * whose first element is the resolution (`name@1.2.3`, `name@workspace:packages/lib`). */
  packages?: Record<string, unknown[]>;
}

/**
 * `bun.lock` is JSON with trailing commas (Bun's "JSONC"). Removes commas that precede a
 * closing bracket, outside strings, so that `JSON.parse` accepts it.
 */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (inString) {
      out += char;
      if (char === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j += 1;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += char;
  }
  return out;
}

/** `a/@scope/b/c` → [`a`, `@scope/b`, `c`]: the package names of a `packages` key. */
function keySegments(key: string): string[] {
  const parts = key.split('/');
  const segments: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] as string;
    if (part.startsWith('@') && i + 1 < parts.length) {
      segments.push(`${part}/${parts[i + 1] as string}`);
      i += 1;
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/** `name@version` → its name and version; the separator is the last `@` after the first character. */
function parseResolution(resolution: string): { name: string; version: string } {
  const at = resolution.indexOf('@', 1);
  if (at === -1) return { name: resolution, version: '' };
  return { name: resolution.slice(0, at), version: resolution.slice(at + 1) };
}

/** The first element of a `packages` entry: `name@version` or `name@workspace:path`. */
function resolutionOf(entry: readonly unknown[] | undefined): string {
  const first = entry?.[0];
  return typeof first === 'string' ? first : '';
}

/** Bun's resolution, like Node's: `<scope>/<name>` for the scope and each of its parents. */
function resolve(
  packages: Record<string, unknown>,
  scope: string,
  name: string,
): string | undefined {
  const segments = scope === '' ? [] : keySegments(scope);
  for (let length = segments.length; length >= 0; length -= 1) {
    const candidate = [...segments.slice(0, length), name].join('/');
    if (candidate in packages) return candidate;
  }
  return undefined;
}

/** Parses Bun's text lockfile, `bun.lock`. The binary `bun.lockb` is not supported. */
export function parseBunLock(text: string): LockGraph {
  let lock: BunLock;
  try {
    lock = JSON.parse(stripTrailingCommas(text)) as BunLock;
  } catch {
    throw new LockfileError('bun.lock is not valid JSON');
  }
  if (lock.workspaces === undefined || lock.packages === undefined) {
    throw new LockfileError('unsupported bun.lock: "workspaces" and "packages" are required');
  }
  const packages = lock.packages;
  const workspaces = lock.workspaces;

  // Workspace path → the `packages` key that links to it (the root has none).
  const workspaceKey = new Map<string, string>([['', '']]);
  for (const [key, entry] of Object.entries(packages)) {
    const { version } = parseResolution(resolutionOf(entry));
    if (version.startsWith('workspace:')) workspaceKey.set(version.slice('workspace:'.length), key);
  }
  const nodeId = (key: string) => {
    const { version } = parseResolution(resolutionOf(packages[key]));
    return version.startsWith('workspace:') ? `workspace:${version.slice(10)}` : key;
  };
  const resolveId = (scope: string, name: string) => {
    const key = resolve(packages, scope, name);
    return key === undefined ? undefined : nodeId(key);
  };

  const nodes = new Map<string, LockNode>();
  const importers = new Map<string, Importer>();
  for (const [key, entry] of Object.entries(packages)) {
    const { name, version } = parseResolution(resolutionOf(entry));
    if (version.startsWith('workspace:')) continue;
    const info = (entry.find((item, index) => index > 0 && typeof item === 'object') ??
      {}) as BunInfo;
    const runtime = {
      ...info.dependencies,
      ...info.optionalDependencies,
      ...info.peerDependencies,
    };
    nodes.set(key, {
      name,
      version,
      deps: Object.keys(runtime).flatMap((dep) => resolveId(key, dep) ?? []),
    });
  }
  for (const [path, workspace] of Object.entries(workspaces)) {
    const scope = workspaceKey.get(path) ?? '';
    const list = (record: Deps | undefined): DirectDependency[] =>
      Object.keys(record ?? {}).flatMap((dep) => {
        const id = resolveId(scope, dep);
        return id === undefined ? [] : [{ name: dep, id }];
      });
    const prod = list({
      ...workspace.dependencies,
      ...workspace.optionalDependencies,
      ...workspace.peerDependencies,
    });
    const importerPath = path === '' ? '.' : path;
    nodes.set(`workspace:${path}`, {
      name: workspace.name ?? importerPath,
      version: workspace.version ?? '0.0.0',
      workspace: importerPath,
      deps: prod.map((d) => d.id),
    });
    importers.set(importerPath, { prod, dev: list(workspace.devDependencies) });
  }
  return { format: 'bun', importers, nodes };
}
