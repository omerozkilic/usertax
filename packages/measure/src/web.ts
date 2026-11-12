import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import type { App, Asset, AssetType, Dependency, Framework, Route } from '@usertax/core';
import { compressedSize } from './compressed-size.js';
import { assignKeys } from './hash.js';
import { foreignSources } from './foreign.js';
import { SourceMapError, attributeBytes, packageBytes, parseSourceMap } from './sourcemap.js';
import { htmlRoutes } from './html-routes.js';
import { installedVersions } from './versions.js';
import type { RawSourceMap } from './sourcemap.js';

const TYPES: Record<string, AssetType> = {
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.woff': 'font',
  '.woff2': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.eot': 'font',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.svg': 'image',
  '.ico': 'image',
  '.json': 'json',
  '.wasm': 'wasm',
};

/** Files in the output directory that are not shipped to users. */
function isShipped(path: string): boolean {
  if (path.endsWith('.map')) return false;
  if (path.split('/').some((part) => part.startsWith('.'))) return false; // .vite/, .DS_Store, …
  if (path.endsWith('.LICENSE.txt')) return false;
  return true;
}

export function assetType(path: string): AssetType {
  const dot = path.lastIndexOf('.');
  return (dot === -1 ? undefined : TYPES[path.slice(dot).toLowerCase()]) ?? 'other';
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

export interface Warning {
  readonly file: string;
  readonly message: string;
}

/** JavaScript files smaller than this get no "no source map" warning. */
export const MIN_WARN_BYTES = 1024;

const SOURCE_MAPPING_URL = /\/[/*][#@]\s*sourceMappingURL=([^\s*]+)\s*(?:\*\/)?\s*$/;

async function findSourceMap(
  outDir: string,
  file: string,
  code: string,
  files: ReadonlySet<string>,
): Promise<{ map: RawSourceMap; mapFile: string } | undefined> {
  const url = SOURCE_MAPPING_URL.exec(code.slice(-2048))?.[1];
  if (url?.startsWith('data:') === true) {
    const base64 = /^data:application\/json(?:;charset=[^;,]+)?;base64,(.*)$/.exec(url)?.[1];
    if (base64 === undefined) throw new SourceMapError('unsupported inline source map encoding');
    return { map: parseSourceMap(Buffer.from(base64, 'base64').toString('utf8')), mapFile: file };
  }
  const candidates = [
    ...(url === undefined ? [] : [posix.normalize(posix.join(posix.dirname(file), url))]),
    `${file}.map`,
  ];
  for (const candidate of candidates) {
    if (files.has(candidate)) {
      return {
        map: parseSourceMap(await readFile(join(outDir, candidate), 'utf8')),
        mapFile: candidate,
      };
    }
  }
  return undefined;
}

export interface ScanOptions {
  /** Absolute path of the build output directory. */
  readonly outDir: string;
  /** Absolute path of the app root; module paths are shown relative to it. */
  readonly appDir: string;
  /** Largest modules kept per asset. Defaults to 100. */
  readonly maxModules?: number;
  /** App root relative to the repository root, to recognise sources outside the repository. */
  readonly appPath?: string;
}

export interface ScanResult {
  readonly assets: Asset[];
  /** Map from output path to asset key. */
  readonly keys: ReadonlyMap<string, string>;
  readonly warnings: Warning[];
}

/** Measures every shipped file of a build output directory. */
export async function scanOutputDir(options: ScanOptions): Promise<ScanResult> {
  const all = await listFiles(options.outDir);
  const fileSet = new Set(all);
  const shipped = all.filter(isShipped);
  const sizes = await Promise.all(
    shipped.map(async (path) => ({ path, size: (await stat(join(options.outDir, path))).size })),
  );
  const keys = assignKeys(sizes);
  const warnings: Warning[] = [];
  const maxModules = options.maxModules ?? 100;
  const outRelative = relative(options.appDir, options.outDir).split(sep).join('/') || '.';

  const assets: Asset[] = [];
  for (const path of shipped) {
    const content = await readFile(join(options.outDir, path));
    const type = assetType(path);
    const size = compressedSize(content);
    const asset: Asset = {
      key: keys.get(path) ?? path,
      file: path,
      type,
      raw: size.raw,
      gzip: size.gzip,
      brotli: size.brotli,
    };
    if (type === 'js') {
      const code = content.toString('utf8');
      try {
        const found = await findSourceMap(options.outDir, path, code, fileSet);
        // Tiny generated files (Next.js build manifests, loaders) rarely have maps; only warn
        // where the missing attribution matters.
        if (found === undefined && content.byteLength >= MIN_WARN_BYTES) {
          warnings.push({
            file: path,
            message: 'no source map found; packages and modules are not attributed',
          });
        } else if (found !== undefined) {
          const mapDir = posix.normalize(posix.join(outRelative, posix.dirname(found.mapFile)));
          const isForeign = await foreignSources(
            found.map,
            mapDir,
            options.appDir,
            options.appPath,
          );
          const versionOf = await installedVersions(found.map, mapDir, options.appDir);
          const attribution = attributeBytes(code, found.map, mapDir, isForeign, versionOf);
          asset.packages = packageBytes(attribution);
          asset.firstPartyBytes = attribution.firstPartyBytes;
          asset.unattributedBytes = attribution.unattributedBytes;
          asset.modules = attribution.modules.slice(0, maxModules);
        }
      } catch (error) {
        if (!(error instanceof SourceMapError)) throw error;
        warnings.push({ file: path, message: `source map ignored: ${error.message}` });
      }
    }
    assets.push(asset);
  }
  return { assets, keys, warnings };
}

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
}

/** Route name of a Vite entry: `index.html` → `/`, `about/index.html` → `/about/`. */
export function entryRoute(src: string): string {
  if (src === 'index.html') return '/';
  if (src.endsWith('/index.html')) return `/${src.slice(0, -'index.html'.length)}`;
  if (src.endsWith('.html')) return `/${src}`;
  return src;
}

/**
 * Reads `.vite/manifest.json` and returns one route per entry with the files it loads
 * initially (the entry, its static imports and their CSS; dynamic imports are excluded).
 */
export async function viteRoutes(
  outDir: string,
  keys: ReadonlyMap<string, string>,
): Promise<Route[] | undefined> {
  let manifest: Record<string, ManifestChunk>;
  try {
    manifest = JSON.parse(await readFile(join(outDir, '.vite', 'manifest.json'), 'utf8')) as Record<
      string,
      ManifestChunk
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const routes: Route[] = [];
  for (const [id, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry !== true) continue;
    const files = new Set<string>();
    const visit = (chunkId: string) => {
      const current = manifest[chunkId];
      if (current === undefined || files.has(current.file)) return;
      files.add(current.file);
      for (const css of current.css ?? []) files.add(css);
      for (const imported of current.imports ?? []) visit(imported);
    };
    visit(id);
    routes.push({
      route: entryRoute(chunk.src ?? id),
      assets: [...files]
        .map((file) => keys.get(file))
        .filter((key): key is string => key !== undefined),
    });
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

export interface MeasureWebAppOptions {
  readonly id: string;
  readonly name: string;
  /** Absolute path of the app root. */
  readonly appDir: string;
  /** App root relative to the repository root, for the report. */
  readonly path: string;
  /** Absolute path of the build output directory. */
  readonly outDir: string;
  readonly framework: Framework;
  /** Resolved dependencies from the lockfile, for attribution (ADR 0008). */
  readonly dependencies?: readonly Dependency[];
}

export interface MeasureResult {
  readonly app: App;
  readonly warnings: Warning[];
}

/** Measures a built web app. The app must already be built. */
export async function measureWebApp(options: MeasureWebAppOptions): Promise<MeasureResult> {
  const scan = await scanOutputDir({
    outDir: options.outDir,
    appDir: options.appDir,
    appPath: options.path,
  });
  const routes =
    options.framework === 'vite'
      ? await viteRoutes(options.outDir, scan.keys)
      : options.framework === 'astro' ||
          options.framework === 'sveltekit' ||
          options.framework === 'nuxt'
        ? await htmlRoutes(options.outDir, scan.keys)
        : undefined;
  return {
    app: {
      id: options.id,
      name: options.name,
      path: options.path,
      kind: 'web',
      framework: options.framework,
      assets: scan.assets,
      ...(routes === undefined ? {} : { routes }),
      ...(options.dependencies === undefined ? {} : { dependencies: [...options.dependencies] }),
    },
    warnings: scan.warnings,
  };
}
