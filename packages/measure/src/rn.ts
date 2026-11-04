import { readFile, readdir } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { decode } from '@jridgewell/sourcemap-codec';
import type { Dependency, Framework, JsBundle, Platform } from '@usertax/core';
import { ArchiveError, analyzeArchive, isHermesBytecode } from './archive.js';
import { compressedSize } from './compressed-size.js';
import { SourceMapError, attributeBytes, classifySources, parseSourceMap } from './sourcemap.js';
import type { Attribution, ForeignSource, RawSourceMap } from './sourcemap.js';
import { foreignSources } from './foreign.js';
import type { MeasureResult, Warning } from './web.js';

/**
 * Attributes Hermes bytecode to sources. Hermes source maps use generated columns as bytecode
 * offsets, so the bytes from one segment to the next belong to that segment's source. The last
 * segment of each line has no known end and, like headers and string tables, stays unattributed.
 */
export function attributeHermes(
  byteLength: number,
  map: RawSourceMap,
  mapDir = '.',
  isForeign?: ForeignSource,
): Attribution {
  const sourceBytes = new Map<number, number>();
  let attributed = 0;
  for (const line of decode(map.mappings)) {
    const segments = [...line].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as (typeof segments)[number];
      const next = segments[i + 1] as (typeof segments)[number];
      const span = Math.min(next[0], byteLength) - Math.min(segment[0], byteLength);
      const source = segment.length >= 4 ? segment[1] : undefined;
      if (span <= 0 || source === undefined || (map.sources[source] ?? null) === null) continue;
      sourceBytes.set(source, (sourceBytes.get(source) ?? 0) + span);
      attributed += span;
    }
  }
  const { foreignBytes, ...classified } = classifySources(sourceBytes, map, mapDir, isForeign);
  return { ...classified, unattributedBytes: byteLength - attributed + foreignBytes };
}

export interface BundleInput {
  readonly platform: Platform;
  /** Absolute path of a JS bundle or Hermes bytecode file. */
  readonly file: string;
  /** Source map; defaults to `<file>.map`. */
  readonly map?: string;
}

/** Measures one React Native bundle: size, format and source-map attribution. */
export async function measureBundle(
  input: BundleInput,
  appDir: string,
  maxModules = 100,
  /** App root relative to the repository root; sources outside it count as unattributed. */
  appPath?: string,
): Promise<{ bundle: JsBundle; warnings: Warning[] }> {
  const content = await readFile(input.file);
  const hermes = isHermesBytecode(content);
  const display = relative(appDir, input.file).split(sep).join('/');
  const bundle: JsBundle = {
    platform: input.platform,
    file: display,
    format: hermes ? 'hermes' : 'js',
    raw: content.byteLength,
    ...(hermes ? {} : (({ gzip, brotli }) => ({ gzip, brotli }))(compressedSize(content))),
  };
  const warnings: Warning[] = [];
  const mapFile = input.map ?? `${input.file}.map`;
  let map: RawSourceMap | undefined;
  try {
    map = parseSourceMap(await readFile(mapFile, 'utf8'));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (!missing && !(error instanceof SourceMapError)) throw error;
    warnings.push({
      file: display,
      message: missing
        ? 'no source map found; packages and modules are not attributed'
        : `source map ignored: ${(error as Error).message}`,
    });
  }
  if (map !== undefined) {
    const mapDir = posix.dirname(relative(appDir, mapFile).split(sep).join('/'));
    const isForeign = await foreignSources(map, mapDir, appDir, appPath);
    const attribution = hermes
      ? attributeHermes(content.byteLength, map, mapDir, isForeign)
      : attributeBytes(content.toString('utf8'), map, mapDir, isForeign);
    bundle.packages = [...attribution.packages.entries()]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
    bundle.firstPartyBytes = attribution.firstPartyBytes;
    bundle.unattributedBytes = attribution.unattributedBytes;
    bundle.modules = attribution.modules.slice(0, maxModules);
  }
  return { bundle, warnings };
}

/** Bundles written by `expo export` into `<dist>/_expo/static/js/<platform>/`. */
export async function findExpoBundles(distDir: string): Promise<BundleInput[]> {
  const bundles: BundleInput[] = [];
  for (const platform of ['android', 'ios'] as const) {
    const dir = join(distDir, '_expo', 'static', 'js', platform);
    const files = await readdir(dir).catch(() => [] as string[]);
    const bundle = files.filter((f) => /\.(hbc|js)$/.test(f)).sort()[0];
    if (bundle !== undefined) bundles.push({ platform, file: join(dir, bundle) });
  }
  return bundles;
}

export interface ArchiveInput {
  readonly file: string;
  readonly key?: string;
}

export interface MeasureRnAppOptions {
  readonly id: string;
  readonly name: string;
  readonly appDir: string;
  readonly path: string;
  readonly framework: Extract<Framework, 'expo' | 'react-native'>;
  readonly bundles: readonly BundleInput[];
  readonly archives: readonly ArchiveInput[];
  readonly dependencies?: readonly Dependency[];
}

/** Measures a React Native app from its bundles and/or built archives. Never builds anything. */
export async function measureRnApp(options: MeasureRnAppOptions): Promise<MeasureResult> {
  const warnings: Warning[] = [];
  const bundles: JsBundle[] = [];
  for (const input of options.bundles) {
    const result = await measureBundle(input, options.appDir, 100, options.path);
    bundles.push(result.bundle);
    warnings.push(...result.warnings);
  }
  const archives = [];
  for (const input of options.archives) {
    try {
      const { archive } = await analyzeArchive({
        file: input.file,
        ...(input.key === undefined ? {} : { key: input.key }),
      });
      archives.push(archive);
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
      warnings.push({ file: input.file, message: error.message });
    }
  }
  return {
    app: {
      id: options.id,
      name: options.name,
      path: options.path,
      kind: 'react-native',
      framework: options.framework,
      ...(bundles.length > 0 ? { bundles } : {}),
      ...(archives.length > 0 ? { archives } : {}),
      ...(options.dependencies === undefined ? {} : { dependencies: [...options.dependencies] }),
    },
    warnings,
  };
}
