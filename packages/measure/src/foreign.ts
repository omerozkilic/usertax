import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { displayPath, isOutsideRepository, packageOf } from './sourcemap.js';
import type { ForeignSource, RawSourceMap } from './sourcemap.js';

/**
 * Finds the foreign sources of a source map: sources outside the app directory that are not in
 * `node_modules` and are neither inside the repository nor on disk. They appear when a bundler
 * chains a dependency's own source map without rebasing its relative paths, e.g. Next.js webpack
 * builds map Next.js's modules to `../../src/client/…`. Such bytes cannot be tied to a package,
 * and they are not this repository's code, so they count as unattributed (ADR 0008).
 *
 * @param mapDir directory of the map file relative to the app root
 * @param appDir absolute path of the app root
 * @param appPath the app root relative to the repository root, when known
 */
export async function foreignSources(
  map: RawSourceMap,
  mapDir: string,
  appDir: string,
  appPath: string | undefined,
): Promise<ForeignSource> {
  const foreign = new Set<string>();
  for (const source of new Set(map.sources)) {
    if (source === null) continue;
    const path = displayPath(source, map.sourceRoot, mapDir);
    if (!path.startsWith('../') || packageOf(path) !== undefined) continue;
    const outside = appPath !== undefined && isOutsideRepository(path, appPath);
    if (outside || (await stat(join(appDir, path)).catch(() => undefined)) === undefined) {
      foreign.add(path);
    }
  }
  return (path) => foreign.has(path);
}
