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
  /**
   * Bytes per installed version, only for packages that the bundle contains in more than one
   * version (package name → version → bytes). Copies whose version could not be determined are
   * left out, so the versions of a package may add up to less than its total.
   */
  readonly versions: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Bytes from sources in the repository outside `node_modules` (app code, bundler runtime). */
  readonly firstPartyBytes: number;
  /**
   * Bytes not covered by any mapping (newlines, wrappers, the source-map comment, …) or mapped to
   * a foreign source: code that no package or repository file can be identified for.
   */
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
 * Drops a `?query` suffix (loader and cache-busting parameters). Source paths come from an
 * untrusted source map, so this avoids a regular expression that backtracks on long input.
 */
function withoutQuery(text: string): string {
  const index = text.indexOf('?');
  return index === -1 ? text : text.slice(0, index);
}

/** One installed copy of a package, as the path where a bundler found it. */
export interface InstallRoot {
  readonly name: string;
  /**
   * Directory of the installed copy, relative to the app root (or absolute), for example
   * `node_modules/.pnpm/lodash@4.17.20/node_modules/lodash`, `node_modules/a/node_modules/lodash`
   * or `../../node_modules/lodash` for a copy hoisted above the app. Two sources share a root
   * exactly when they come from the same installed copy.
   */
  readonly root: string;
}

/**
 * Finds the installed copy a source belongs to, or `undefined` for code outside `node_modules`.
 *
 * @param mapDir directory of the map file, relative to the app root (posix)
 */
export function installRoot(
  source: string,
  sourceRoot: string | undefined,
  mapDir: string,
): InstallRoot | undefined {
  // Resolve the source the way a bundler wrote it: webpack and Turbopack paths are relative to the
  // app root, everything else to the map file.
  const webpack = /^webpack:\/\/[^/]*\/(.*)$/s.exec(source);
  const clean = withoutQuery(
    (webpack?.[1] ?? source).replace(/^\0/, '').replace(/^[a-z]+:\/\/\/?/i, ''),
  );
  const project = clean.startsWith('[project]/') ? clean.slice('[project]/'.length) : undefined;
  const full = project ?? (posix.isAbsolute(clean) ? clean : undefined);
  const path = posix.normalize(
    full ?? (webpack !== null ? clean : posix.join(mapDir, sourceRoot ?? '', clean)),
  );
  const marker = '/node_modules/';
  const name = packageOf(path);
  if (name === undefined) return undefined;
  const root = path.slice(0, `/${path}`.lastIndexOf(marker) + marker.length + name.length - 1);
  // The source map is untrusted input and a root is later used to find a `package.json`: allow
  // `..` only as a prefix (a copy hoisted above the app).
  const segments = root.replace(/^(\.\.\/)+/, '').split('/');
  const absolute = root.startsWith('/');
  if (
    segments.slice(absolute ? 1 : 0).some((s) => s === '' || s === '.' || s === '..') ||
    root.includes('\\')
  ) {
    return undefined;
  }
  return { name, root };
}

const VERSION_TEXT = /^[0-9A-Za-z][0-9A-Za-z.+_~-]{0,63}$/;

/** Whether text can be reported as a package version (bounded, no markup). */
export function isVersionText(text: unknown): text is string {
  return typeof text === 'string' && VERSION_TEXT.test(text);
}

/**
 * The version in pnpm's virtual store folder name (`.pnpm/<name>@<version>[_<peers>]/…`), which is
 * the only layout that records it in the path.
 */
export function pnpmVersion({ name, root }: InstallRoot): string | undefined {
  const folder = /(?:^|\/)node_modules\/\.pnpm\/([^/]+)\/node_modules\//.exec(`${root}/`)?.[1];
  const prefix = `${name.replaceAll('/', '+')}@`;
  if (folder?.startsWith(prefix) !== true) return undefined;
  const version = folder.slice(prefix.length).split(/[_(]/)[0];
  return isVersionText(version) ? version : undefined;
}

/** Resolves the version of an installed copy that the path does not name (npm, Yarn, Bun). */
export type VersionOf = (copy: InstallRoot) => string | undefined;

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
  // webpack: `webpack://<namespace>/<path>` is relative to the webpack context (the app root),
  // not to the map file.
  const webpack = /^webpack:\/\/[^/]*\/(.*)$/s.exec(source);
  const clean = withoutQuery(
    (webpack?.[1] ?? source).replace(/^\0/, '').replace(/^[a-z]+:\/\/\/?/i, ''),
  );
  if (virtual) return `(virtual) ${clean}`;
  if (webpack !== null) {
    // The webpack runtime, ignored modules (`ignored|…`) and generated loader modules.
    if (clean === '' || clean.startsWith('webpack/') || clean.includes('|')) {
      const name = clean.startsWith('webpack/') ? clean.slice('webpack/'.length) : clean;
      return `(virtual) webpack${name === '' ? '' : `/${name.split('|')[0] ?? ''}`}`;
    }
  }
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
  if (posix.isAbsolute(clean)) return clean;
  return posix.normalize(webpack !== null ? clean : posix.join(mapDir, sourceRoot ?? '', clean));
}

/**
 * Whether a display path resolves above the repository root.
 *
 * @param appPath the app root relative to the repository root
 */
export function isOutsideRepository(path: string, appPath: string): boolean {
  if (path.startsWith('(virtual) ') || posix.isAbsolute(path)) return false;
  const resolved = posix.normalize(posix.join(appPath, path));
  return resolved === '..' || resolved.startsWith('../');
}

/**
 * Decides whether a source (by display path) is code that no package or file in the repository
 * can be identified for. Such bytes are counted as unattributed instead of first-party.
 */
export type ForeignSource = (path: string) => boolean;

/** Groups attributed bytes per source into packages, first-party code and modules. */
export function classifySources(
  sourceBytes: ReadonlyMap<number, number>,
  map: RawSourceMap,
  mapDir: string,
  isForeign: ForeignSource = () => false,
  versionOf?: VersionOf,
): Omit<Attribution, 'unattributedBytes'> & { readonly foreignBytes: number } {
  const modules = new Map<string, { package?: string; bytes: number }>();
  const packages = new Map<string, number>();
  const perVersion = new Map<string, Map<string, number>>();
  let firstParty = 0;
  let foreign = 0;
  for (const [sourceIndex, bytes] of sourceBytes) {
    const source = map.sources[sourceIndex] as string;
    const path = displayPath(source, map.sourceRoot, mapDir);
    const pkg = packageOf(path);
    if (pkg === undefined && isForeign(path)) {
      foreign += bytes;
      continue;
    }
    modules.set(path, {
      ...(pkg === undefined ? {} : { package: pkg }),
      bytes: (modules.get(path)?.bytes ?? 0) + bytes,
    });
    if (pkg === undefined) {
      firstParty += bytes;
      continue;
    }
    packages.set(pkg, (packages.get(pkg) ?? 0) + bytes);
    const copy = installRoot(source, map.sourceRoot, mapDir);
    const version = copy === undefined ? undefined : (pnpmVersion(copy) ?? versionOf?.(copy));
    if (copy?.name === pkg && version !== undefined) {
      const byVersion = perVersion.get(pkg) ?? new Map<string, number>();
      byVersion.set(version, (byVersion.get(version) ?? 0) + bytes);
      perVersion.set(pkg, byVersion);
    }
  }
  return {
    packages,
    versions: new Map([...perVersion].filter(([, byVersion]) => byVersion.size > 1)),
    firstPartyBytes: firstParty,
    foreignBytes: foreign,
    modules: [...modules.entries()]
      .map(([path, value]) => ({ path, ...value }))
      .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)),
  };
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
 * @param isForeign sources counted as unattributed instead of first-party
 * @param versionOf resolves the version of installed copies that the path does not name
 */
export function attributeBytes(
  code: string,
  map: RawSourceMap,
  mapDir = '.',
  isForeign?: ForeignSource,
  versionOf?: VersionOf,
): Attribution {
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

  const { foreignBytes, ...classified } = classifySources(
    sourceBytes,
    map,
    mapDir,
    isForeign,
    versionOf,
  );
  return { ...classified, unattributedBytes: unattributed + foreignBytes };
}

/** A package's bytes as reported, with the per-version split when the bundle holds several. */
export interface PackageBytes {
  readonly name: string;
  readonly bytes: number;
  versions?: { version: string; bytes: number }[];
}

/** Lists the packages of an attribution, largest first. */
export function packageBytes(attribution: Attribution): PackageBytes[] {
  return [...attribution.packages.entries()]
    .map(([name, bytes]): PackageBytes => {
      const byVersion = attribution.versions.get(name);
      if (byVersion === undefined) return { name, bytes };
      const versions = [...byVersion.entries()]
        .map(([version, versionBytes]) => ({ version, bytes: versionBytes }))
        .sort((a, b) => b.bytes - a.bytes || a.version.localeCompare(b.version));
      return { name, bytes, versions };
    })
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}
