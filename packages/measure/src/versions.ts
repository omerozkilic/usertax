import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { installRoot, isVersionText, pnpmVersion } from './sourcemap.js';
import type { InstallRoot, RawSourceMap, VersionOf } from './sourcemap.js';

async function readVersion(directory: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return isVersionText(json.version) ? json.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the installed version of every package that a source map reaches through more than one
 * installed copy: the only packages that can be duplicated. pnpm names the version in the path
 * (see `pnpmVersion`); for npm, Yarn and Bun it is read from the copy's `package.json`.
 *
 * A copy whose `package.json` cannot be read has no version and is left out of the per-version
 * split instead of being guessed.
 *
 * @param mapDir directory of the map file relative to the app root
 * @param appDir absolute path of the app root
 */
export async function installedVersions(
  map: RawSourceMap,
  mapDir: string,
  appDir: string,
): Promise<VersionOf> {
  const copies = new Map<string, Map<string, InstallRoot>>();
  for (const source of new Set(map.sources)) {
    if (source === null) continue;
    const copy = installRoot(source, map.sourceRoot, mapDir);
    if (copy === undefined) continue;
    const roots = copies.get(copy.name) ?? new Map<string, InstallRoot>();
    roots.set(copy.root, copy);
    copies.set(copy.name, roots);
  }
  const versions = new Map<string, string>();
  for (const roots of copies.values()) {
    if (roots.size < 2) continue;
    for (const copy of roots.values()) {
      if (pnpmVersion(copy) !== undefined) continue;
      const version = await readVersion(resolve(appDir, copy.root));
      if (version !== undefined) versions.set(copy.root, version);
    }
  }
  return (copy) => versions.get(copy.root);
}
