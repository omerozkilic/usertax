import { posix } from 'node:path';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import type { SourceMapMappings } from '@jridgewell/sourcemap-codec';

/** The parts of a source map (v3) that usertax reads. */
export interface RawSourceMap {
  readonly version: number;
  readonly sources: readonly (string | null)[];
  readonly sourceRoot?: string;
  readonly mappings: string;
}

export interface ModuleBytes {
  /** Display path: `node_modules/<pkg>/…` for dependencies, otherwise relative to the app. */
  readonly path: string;
  readonly package?: string;
  readonly bytes: number;
}

export interface Attribution {
  /** Bytes per npm package. */
  readonly packages: ReadonlyMap<string, number>;
  /** Bytes from sources outside `node_modules` (app code, bundler runtime, virtual modules). */
  readonly firstPartyBytes: number;
  /** Bytes not covered by any mapping (newlines, wrappers, the source-map comment, …). */
  readonly unattributedBytes: number;
  /** Bytes per source module, largest first. */
  readonly modules: readonly ModuleBytes[];
}

export class SourceMapError extends Error {
  override readonly name = 'SourceMapError';
}

/** Parses JSON text as a source map and checks the fields usertax needs. */
export function parseSourceMap(text: string): RawSourceMap {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SourceMapError('source map is not valid JSON');
  }
  if (typeof json !== 'object' || json === null)
    throw new SourceMapError('source map is not an object');
  const map = json as Record<string, unknown>;
  if (map['version'] !== 3) throw new SourceMapError('only source map version 3 is supported');
  if ('sections' in map) return flattenSections(map['sections']);
  if (!Array.isArray(map['sources']) || typeof map['mappings'] !== 'string') {
    throw new SourceMapError('source map needs "sources" and "mappings"');
  }
  return {
    version: 3,
    sources: map['sources'] as (string | null)[],
    ...(typeof map['sourceRoot'] === 'string' ? { sourceRoot: map['sourceRoot'] } : {}),
    mappings: map['mappings'],
  };
}

interface Section {
  offset?: { line?: number; column?: number };
  map?: unknown;
  url?: unknown;
}

/**
 * Flattens an indexed source map (Metro writes these for React Native bundles): each section's
 * mappings are shifted by its offset and its sources appended to one list.
 */
function flattenSections(sections: unknown): RawSourceMap {
  if (!Array.isArray(sections)) throw new SourceMapError('"sections" must be an array');
  const sources: (string | null)[] = [];
  const lines: SourceMapMappings = [];
  for (const raw of sections as Section[]) {
    if (raw.url !== undefined)
      throw new SourceMapError('indexed source maps with "url" sections are not supported');
    const inner = raw.map as
      { sources?: unknown; sourceRoot?: unknown; mappings?: unknown } | undefined;
    if (
      inner === undefined ||
      !Array.isArray(inner.sources) ||
      typeof inner.mappings !== 'string'
    ) {
      throw new SourceMapError('source map section needs "sources" and "mappings"');
    }
    const line = raw.offset?.line ?? 0;
    const column = raw.offset?.column ?? 0;
    const root = typeof inner.sourceRoot === 'string' ? inner.sourceRoot : '';
    const base = sources.length;
    for (const source of inner.sources as (string | null)[])
      sources.push(source === null ? null : `${root}${source}`);
    decode(inner.mappings).forEach((segments, index) => {
      const target = line + index;
      while (lines.length <= target) lines.push([]);
      const shifted = segments.map((segment) => {
        const generated = segment[0] + (index === 0 ? column : 0);
        if (segment.length === 1) return [generated] as [number];
        const [, sourceIndex, originalLine, originalColumn] = segment as [
          number,
          number,
          number,
          number,
        ];
        return [generated, sourceIndex + base, originalLine, originalColumn] as [
          number,
          number,
          number,
          number,
        ];
      });
      (lines[target] as (typeof lines)[number]).push(...shifted);
    });
  }
  return { version: 3, sources, mappings: encode(lines) };
}

/** Package name of a path inside `node_modules`, e.g. `react-dom` or `@scope/pkg`. */
export function packageOf(path: string): string | undefined {
  const marker = '/node_modules/';
  const normalized = `/${path}`;
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return undefined;
  const parts = normalized.slice(index + marker.length).split('/');
  const first = parts[0];
  if (first === undefined || first === '' || first === '.pnpm') return undefined;
  if (first.startsWith('@')) {
    const second = parts[1];
    return second === undefined || second === '' ? undefined : `${first}/${second}`;
  }
  return first;
}

/**
 * Turns a source entry into a display path.
 *
 * @param mapDir directory of the map file, relative to the app root (posix)
 */
export function displayPath(
  source: string,
  sourceRoot: string | undefined,
  mapDir: string,
): string {
  // Bundlers mark virtual modules with a leading NUL byte.
  const virtual = source.startsWith('\0');
  const clean = source
    .replace(/^\0/, '')
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^[a-z]+:\/\/\/?/i, '')
    .replace(/\?.*$/, '');
  if (virtual) return `(virtual) ${clean}`;
  // Turbopack: `turbopack:///[project]/…` is relative to the project root, `[turbopack]/…` is
  // the bundler runtime.
  if (clean.startsWith('[turbopack]/'))
    return `(virtual) turbopack/${clean.slice('[turbopack]/'.length)}`;
  const project = clean.startsWith('[project]/') ? clean.slice('[project]/'.length) : undefined;
  if (project !== undefined && !project.includes('node_modules/')) return project;
  const marker = clean.lastIndexOf('node_modules/');
  if (marker !== -1) {
    return clean
      .slice(marker)
      .replace(/^node_modules\/\.pnpm\/[^/]+\/node_modules\//, 'node_modules/');
  }
  const joined = posix.isAbsolute(clean)
    ? clean
    : posix.normalize(posix.join(mapDir, sourceRoot ?? '', clean));
  return joined;
}

// eslint-disable-next-line no-control-regex -- matching the whole ASCII range is the point
const ASCII = /^[\x00-\x7f]*$/;

function utf8Length(text: string): number {
  return ASCII.test(text) ? text.length : Buffer.byteLength(text, 'utf8');
}

/**
 * Attributes every byte of a generated file to the original source of its mapping segment.
 * A segment covers the generated columns up to the next segment on the same line.
 *
 * @param code the generated file as shipped
 * @param mapDir directory of the map file relative to the app root, used to resolve sources
 */
export function attributeBytes(code: string, map: RawSourceMap, mapDir = '.'): Attribution {
  const lines = code.split('\n');
  const decoded = decode(map.mappings);
  const sourceBytes = new Map<number, number>();
  let unattributed = Math.max(0, lines.length - 1); // newline characters

  for (const [lineIndex, line] of lines.entries()) {
    const segments = [...(decoded[lineIndex] ?? [])].sort((a, b) => a[0] - b[0]);
    const firstColumn = segments[0]?.[0] ?? line.length;
    unattributed += utf8Length(line.slice(0, Math.min(firstColumn, line.length)));
    for (const [index, segment] of segments.entries()) {
      const start = Math.min(segment[0], line.length);
      const end = Math.min(segments[index + 1]?.[0] ?? line.length, line.length);
      if (end <= start) continue;
      const bytes = utf8Length(line.slice(start, end));
      const sourceIndex = segment.length >= 4 ? segment[1] : undefined;
      const source = sourceIndex === undefined ? undefined : map.sources[sourceIndex];
      if (sourceIndex === undefined || source === undefined || source === null)
        unattributed += bytes;
      else sourceBytes.set(sourceIndex, (sourceBytes.get(sourceIndex) ?? 0) + bytes);
    }
  }

  const modules = new Map<string, { package?: string; bytes: number }>();
  const packages = new Map<string, number>();
  let firstParty = 0;
  for (const [sourceIndex, bytes] of sourceBytes) {
    const source = map.sources[sourceIndex] as string;
    const path = displayPath(source, map.sourceRoot, mapDir);
    const pkg = packageOf(path);
    const existing = modules.get(path);
    modules.set(path, {
      ...(pkg === undefined ? {} : { package: pkg }),
      bytes: (existing?.bytes ?? 0) + bytes,
    });
    if (pkg === undefined) firstParty += bytes;
    else packages.set(pkg, (packages.get(pkg) ?? 0) + bytes);
  }

  return {
    packages,
    firstPartyBytes: firstParty,
    unattributedBytes: unattributed,
    modules: [...modules.entries()]
      .map(([path, value]) => ({ path, ...value }))
      .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)),
  };
}
