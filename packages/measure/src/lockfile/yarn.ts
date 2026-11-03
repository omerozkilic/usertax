import { parse } from 'yaml';
import type { PackageJson } from '../detect.js';
import { LockfileError } from './graph.js';
import type { Importer, LockGraph, LockNode } from './graph.js';

interface YarnEntry {
  version: string;
  resolution?: string;
  dependencies: Record<string, string>;
}

/** Name of a descriptor such as `@scope/pkg@^1.0.0` or `react@npm:19.3.1`. */
function descriptorName(descriptor: string): string {
  const at = descriptor.indexOf('@', descriptor.startsWith('@') ? 1 : 0);
  return at === -1 ? descriptor : descriptor.slice(0, at);
}

function unquote(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

/** Parses the Yarn 1 lockfile format into descriptor → entry. */
function parseClassic(text: string): Map<string, YarnEntry> {
  const entries = new Map<string, YarnEntry>();
  let current: YarnEntry | undefined;
  let section: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      current = { version: '', dependencies: {} };
      section = undefined;
      const entry = current;
      for (const descriptor of line.replace(/:$/, '').split(','))
        entries.set(unquote(descriptor), entry);
      continue;
    }
    if (current === undefined)
      throw new LockfileError('malformed yarn.lock: indented line before the first entry');
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    if (indent === 2) {
      section = content.endsWith(':') ? content.slice(0, -1) : undefined;
      const version = /^version "?([^"]+)"?$/.exec(content);
      if (version?.[1] !== undefined) current.version = version[1];
    } else if (indent === 4 && (section === 'dependencies' || section === 'optionalDependencies')) {
      const space = content.lastIndexOf(' ');
      current.dependencies[unquote(content.slice(0, space))] = unquote(content.slice(space + 1));
    }
  }
  return entries;
}

interface BerryEntry {
  // YAML parses versions such as `10` as numbers.
  version?: string | number;
  resolution?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function parseBerry(text: string): Map<string, YarnEntry> {
  const doc = parse(text) as Record<string, BerryEntry> | null;
  const entries = new Map<string, YarnEntry>();
  for (const [key, value] of Object.entries(doc ?? {})) {
    if (key === '__metadata') continue;
    const entry: YarnEntry = {
      version: String(value.version ?? '0.0.0'),
      ...(value.resolution === undefined ? {} : { resolution: value.resolution }),
      dependencies: { ...value.dependencies, ...value.optionalDependencies },
    };
    for (const descriptor of key.split(',')) entries.set(descriptor.trim(), entry);
  }
  return entries;
}

export interface YarnWorkspace {
  /** Path relative to the lockfile directory (`.` for the root). */
  readonly path: string;
  readonly manifest: PackageJson;
}

/**
 * Parses `yarn.lock` (Yarn 1 and Yarn 2+). Yarn 1 lockfiles do not record workspaces, so the
 * workspace manifests are passed in; Yarn 2+ lockfiles contain `name@workspace:path` entries.
 */
export function parseYarnLock(text: string, workspaces: readonly YarnWorkspace[]): LockGraph {
  const berry = /^__metadata:/m.test(text);
  const entries = berry ? parseBerry(text) : parseClassic(text);
  const nodes = new Map<string, LockNode>();
  const ids = new Map<YarnEntry, string>();
  const workspaceByName = new Map<string, string>();
  for (const workspace of workspaces) {
    if (workspace.manifest.name !== undefined)
      workspaceByName.set(workspace.manifest.name, workspace.path);
  }

  const idOf = (entry: YarnEntry, descriptor: string): string => {
    const existing = ids.get(entry);
    if (existing !== undefined) return existing;
    const workspace = /@workspace:(.+)$/.exec(entry.resolution ?? '')?.[1];
    const id =
      workspace === undefined
        ? `${descriptorName(descriptor)}@${entry.version}`
        : `workspace:${workspace}`;
    ids.set(entry, id);
    return id;
  };
  const lookup = (name: string, range: string): string | undefined => {
    const entry =
      entries.get(`${name}@${range}`) ?? (berry ? undefined : entries.get(`${name}@npm:${range}`));
    if (entry !== undefined) return idOf(entry, `${name}@${range}`);
    const workspace = workspaceByName.get(name);
    return workspace === undefined ? undefined : `workspace:${workspace}`;
  };

  for (const [descriptor, entry] of entries) {
    const id = idOf(entry, descriptor);
    if (nodes.has(id)) continue;
    const workspace = id.startsWith('workspace:') ? id.slice('workspace:'.length) : undefined;
    const deps = Object.entries(entry.dependencies)
      .map(([name, range]) => lookup(name, range))
      .filter((child): child is string => child !== undefined);
    nodes.set(id, {
      name: descriptorName(descriptor),
      version: entry.version,
      ...(workspace === undefined ? {} : { workspace }),
      deps,
    });
  }

  const importers = new Map<string, Importer>();
  for (const workspace of workspaces) {
    const list = (record: Record<string, string> | undefined) =>
      Object.entries(record ?? {}).flatMap(([name, range]) => {
        const id = lookup(name, berry && !range.includes(':') ? `npm:${range}` : range);
        return id === undefined ? [] : [{ name, id }];
      });
    const prod = list({
      ...workspace.manifest.dependencies,
      ...workspace.manifest.optionalDependencies,
    });
    const dev = list(workspace.manifest.devDependencies);
    importers.set(workspace.path, { prod, dev });
    const id = `workspace:${workspace.path}`;
    if (!nodes.has(id))
      nodes.set(id, {
        name: workspace.manifest.name ?? workspace.path,
        version: '0.0.0',
        workspace: workspace.path,
        deps: prod.map((dep) => dep.id),
      });
  }
  return { format: berry ? 'yarn-berry' : 'yarn-classic', importers, nodes };
}
