import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { Platform, Update } from '@usertax/core';
import type { Warning } from './web.js';

const PLATFORMS = ['android', 'ios'] as const satisfies readonly Platform[];

export interface ExpoUpdateResult {
  readonly updates: Update[];
  readonly warnings: Warning[];
}

interface PlatformFiles {
  readonly bundle: string;
  readonly assets: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function platformFiles(value: unknown): PlatformFiles | undefined {
  if (!isRecord(value) || typeof value['bundle'] !== 'string') return undefined;
  const assets = Array.isArray(value['assets']) ? value['assets'] : [];
  const paths = assets.flatMap((asset: unknown) =>
    isRecord(asset) && typeof asset['path'] === 'string' ? [asset['path']] : [],
  );
  return { bundle: value['bundle'], assets: [...new Set(paths)] };
}

/** Size of a regular file inside `dir`, or a reason it cannot be counted. */
async function sizeInside(dir: string, path: string): Promise<number | string> {
  const outside = relative(dir, join(dir, path));
  if (isAbsolute(path) || outside.startsWith('..') || isAbsolute(outside))
    return 'is outside the export directory';
  const info = await lstat(join(dir, path)).catch(() => undefined);
  if (info === undefined) return 'is listed in metadata.json but missing';
  if (!info.isFile()) return 'is not a regular file';
  return info.size;
}

/**
 * Measures what `expo export` produced for an EAS Update, per platform: the launch bundle and
 * the assets that `metadata.json` lists, as sizes on disk. Reads files only; EAS is never
 * contacted and nothing is built. A directory without `metadata.json` is not an Expo export and
 * gives no updates and no warning.
 */
export async function measureExpoUpdates(distDir: string): Promise<ExpoUpdateResult> {
  const file = join(distDir, 'metadata.json');
  const text = await readFile(file, 'utf8').catch(() => undefined);
  const updates: Update[] = [];
  const warnings: Warning[] = [];
  if (text === undefined) return { updates, warnings };
  let metadata: unknown;
  try {
    metadata = JSON.parse(text);
  } catch {
    return { updates, warnings: [{ file, message: 'is not valid JSON; update size skipped' }] };
  }
  const platforms = isRecord(metadata) ? metadata['fileMetadata'] : undefined;
  if (!isRecord(platforms))
    return { updates, warnings: [{ file, message: 'has no fileMetadata; update size skipped' }] };
  for (const platform of PLATFORMS) {
    if (!(platform in platforms)) continue;
    const files = platformFiles(platforms[platform]);
    if (files === undefined) {
      warnings.push({ file, message: `has no bundle for ${platform}; update size skipped` });
      continue;
    }
    const bundleBytes = await sizeInside(distDir, files.bundle);
    if (typeof bundleBytes === 'string') {
      warnings.push({
        file: join(distDir, files.bundle),
        message: `${bundleBytes}; ${platform} update size skipped`,
      });
      continue;
    }
    let assetBytes = 0;
    let assetCount = 0;
    for (const asset of files.assets) {
      const size = await sizeInside(distDir, asset);
      if (typeof size === 'string') {
        warnings.push({ file: join(distDir, asset), message: `${size}; not counted` });
        continue;
      }
      assetBytes += size;
      assetCount += 1;
    }
    updates.push({ platform, file: files.bundle, bundleBytes, assetCount, assetBytes });
  }
  return { updates, warnings };
}
