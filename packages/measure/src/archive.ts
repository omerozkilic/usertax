import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import { constants, inflateRawSync } from 'node:zlib';
import type { Archive, ArchiveCategory, Platform } from '@usertax/core';

export class ArchiveError extends Error {
  override readonly name = 'ArchiveError';
}

export interface ZipEntry {
  readonly path: string;
  readonly method: number;
  readonly compressed: number;
  readonly uncompressed: number;
  readonly localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

function u64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArchiveError('ZIP64 value too large');
  return Number(value);
}

/** Reads the central directory of a ZIP file (APK, AAB and IPA are ZIP files), including ZIP64. */
export async function readZipEntries(handle: FileHandle, size: number): Promise<ZipEntry[]> {
  const tailLength = Math.min(size, 22 + MAX_COMMENT);
  const tail = await readAt(handle, size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ArchiveError('not a ZIP archive (no end of central directory record)');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locatorAt = size - tailLength + eocd - 20;
    const locator = await readAt(handle, locatorAt, 20);
    if (locator.length < 20 || locator.readUInt32LE(0) !== ZIP64_LOCATOR) {
      throw new ArchiveError('ZIP64 archive without a ZIP64 end of central directory locator');
    }
    const record = await readAt(handle, u64(locator, 8), 56);
    if (record.readUInt32LE(0) !== ZIP64_EOCD)
      throw new ArchiveError('invalid ZIP64 end of central directory record');
    count = u64(record, 32);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  }
  if (cdOffset + cdSize > size) throw new ArchiveError('central directory points outside the file');
  const cd = await readAt(handle, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > cd.length || cd.readUInt32LE(at) !== CENTRAL)
      throw new ArchiveError('corrupt central directory');
    const flags = cd.readUInt16LE(at + 8);
    const method = cd.readUInt16LE(at + 10);
    let compressed = cd.readUInt32LE(at + 20);
    let uncompressed = cd.readUInt32LE(at + 24);
    const nameLength = cd.readUInt16LE(at + 28);
    const extraLength = cd.readUInt16LE(at + 30);
    const commentLength = cd.readUInt16LE(at + 32);
    let localHeaderOffset = cd.readUInt32LE(at + 42);
    const name = cd.subarray(at + 46, at + 46 + nameLength);
    const path = (flags & 0x800) !== 0 ? name.toString('utf8') : name.toString('latin1');
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = cd.readUInt16LE(extra);
      const length = cd.readUInt16LE(extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        if (uncompressed === 0xffffffff) {
          uncompressed = u64(cd, field);
          field += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = u64(cd, field);
          field += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, field);
      }
      extra += 4 + length;
    }
    if (!path.endsWith('/'))
      entries.push({ path, method, compressed, uncompressed, localHeaderOffset });
    at = extraEnd + commentLength;
  }
  return entries;
}

/** First bytes of an entry's uncompressed data (stored or deflated entries only). */
export async function readEntryPrefix(
  handle: FileHandle,
  entry: ZipEntry,
  length = 16,
): Promise<Buffer | undefined> {
  const header = await readAt(handle, entry.localHeaderOffset, 30);
  if (header.length < 30 || header.readUInt32LE(0) !== LOCAL) return undefined;
  const dataAt = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.method === 0) return readAt(handle, dataAt, Math.min(length, entry.compressed));
  if (entry.method !== 8) return undefined;
  const chunk = await readAt(handle, dataAt, Math.min(entry.compressed, 4096));
  try {
    return inflateRawSync(chunk, { finishFlush: constants.Z_SYNC_FLUSH }).subarray(0, length);
  } catch {
    return undefined;
  }
}

/**
 * Reads one file from a ZIP archive (stored or deflated). Used for GitHub Actions artifacts,
 * which download as ZIP files. Refuses entries larger than `maxBytes` uncompressed.
 */
export async function readZipFile(
  path: string,
  name: string,
  maxBytes = 50_000_000,
): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const entries = await readZipEntries(handle, (await handle.stat()).size);
    const entry = entries.find((e) => e.path === name);
    if (entry === undefined) throw new ArchiveError(`${name} not found in ${basename(path)}`);
    if (entry.uncompressed > maxBytes)
      throw new ArchiveError(`${name} is larger than ${maxBytes} bytes`);
    const header = await readAt(handle, entry.localHeaderOffset, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL)
      throw new ArchiveError(`corrupt local header for ${name}`);
    const dataAt = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const data = await readAt(handle, dataAt, entry.compressed);
    if (entry.method === 0) return data;
    if (entry.method !== 8)
      throw new ArchiveError(`unsupported compression method ${entry.method} for ${name}`);
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } finally {
    await handle.close();
  }
}

/** Hermes bytecode files start with this magic number. */
export const HERMES_MAGIC = Buffer.from('c61fbc03c103191f', 'hex');

export function isHermesBytecode(prefix: Uint8Array | undefined): boolean {
  return (
    prefix !== undefined &&
    prefix.length >= 8 &&
    HERMES_MAGIC.equals(Buffer.from(prefix.subarray(0, 8)))
  );
}

export type ArchiveFormat = Archive['format'];

/** Category of one archive entry (ADR 0009). */
export function categorize(format: ArchiveFormat, path: string): ArchiveCategory {
  if (format === 'ipa') {
    const app = /^Payload\/([^/]+)\.app\/(.*)$/.exec(path);
    if (app === null) return 'other';
    const [, name, inner = ''] = app;
    if (inner.startsWith('Frameworks/') || inner.startsWith('PlugIns/')) return 'frameworks';
    if (inner === 'main.jsbundle') return 'js-bundle';
    if (inner === name) return 'binary';
    if (
      inner === 'Assets.car' ||
      inner.startsWith('assets/') ||
      /\.(png|jpe?g|gif|webp|ttf|otf|mp3|mp4|json)$/i.test(inner)
    )
      return 'assets';
    if (/\.(lproj|nib|storyboardc|plist|strings)(\/|$)/.test(inner)) return 'resources';
    return 'other';
  }
  // AAB modules (base/, feature/) hold the same layout as an APK under a directory.
  const inner = format === 'aab' ? path.replace(/^[^/]+\//, '') : path;
  if (format === 'aab' && (path.startsWith('BUNDLE-METADATA/') || path.startsWith('META-INF/')))
    return 'other';
  const dex = format === 'aab' ? inner.startsWith('dex/') : /^classes\d*\.dex$/.test(inner);
  if (dex) return 'dex';
  if (inner.startsWith('lib/')) return 'native';
  if (inner === 'assets/index.android.bundle') return 'js-bundle';
  if (inner.startsWith('assets/')) return 'assets';
  if (inner.startsWith('res/') || inner === 'resources.arsc' || inner === 'resources.pb')
    return 'resources';
  return 'other';
}

function detectFormat(file: string, entries: readonly ZipEntry[]): ArchiveFormat {
  const extension = /\.(apk|aab|ipa)$/i.exec(file)?.[1]?.toLowerCase();
  if (extension === 'apk' || extension === 'aab' || extension === 'ipa') return extension;
  const paths = new Set(entries.map((e) => e.path));
  if (paths.has('base/manifest/AndroidManifest.xml')) return 'aab';
  if (paths.has('AndroidManifest.xml')) return 'apk';
  if (entries.some((e) => e.path.startsWith('Payload/'))) return 'ipa';
  throw new ArchiveError(`cannot tell whether ${basename(file)} is an APK, AAB or IPA`);
}

export interface AnalyzeArchiveOptions {
  readonly file: string;
  /** Identity across builds; defaults to the platform. */
  readonly key?: string;
  /** Entries smaller than this (compressed) are aggregated into `omittedEntries`. Default 1 kB. */
  readonly minEntryBytes?: number;
}

export interface ArchiveAnalysis {
  readonly archive: Archive;
  /** Whether the JS bundle inside the archive is Hermes bytecode (undefined without a bundle). */
  readonly hermes?: boolean;
}

/** Analyses an APK, AAB or IPA by reading its ZIP central directory. Never extracts it. */
export async function analyzeArchive(options: AnalyzeArchiveOptions): Promise<ArchiveAnalysis> {
  const handle = await open(options.file, 'r').catch((error: unknown) => {
    throw new ArchiveError(
      `cannot open ${options.file}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`,
    );
  });
  try {
    const { size } = await handle.stat();
    const entries = await readZipEntries(handle, size);
    const format = detectFormat(options.file, entries);
    const platform: Platform = format === 'ipa' ? 'ios' : 'android';
    const minEntryBytes = options.minEntryBytes ?? 1000;
    const categories = new Map<
      ArchiveCategory,
      { compressed: number; uncompressed: number; count: number }
    >();
    const kept: Archive['entries'] = [];
    const omitted = { count: 0, compressed: 0, uncompressed: 0 };
    let bundle: ZipEntry | undefined;
    for (const entry of entries) {
      const category = categorize(format, entry.path);
      if (category === 'js-bundle') bundle = entry;
      const total = categories.get(category) ?? { compressed: 0, uncompressed: 0, count: 0 };
      total.compressed += entry.compressed;
      total.uncompressed += entry.uncompressed;
      total.count += 1;
      categories.set(category, total);
      if (entry.compressed >= minEntryBytes) {
        kept.push({
          path: entry.path,
          category,
          compressed: entry.compressed,
          uncompressed: entry.uncompressed,
        });
      } else {
        omitted.count += 1;
        omitted.compressed += entry.compressed;
        omitted.uncompressed += entry.uncompressed;
      }
    }
    const hermes =
      bundle === undefined ? undefined : isHermesBytecode(await readEntryPrefix(handle, bundle));
    return {
      archive: {
        key: options.key ?? platform,
        file: basename(options.file),
        format,
        platform,
        fileSize: size,
        entryCount: entries.length,
        categories: [...categories.entries()]
          .map(([category, total]) => ({ category, ...total }))
          .sort((a, b) => b.compressed - a.compressed),
        entries: kept.sort((a, b) => b.compressed - a.compressed || a.path.localeCompare(b.path)),
        ...(omitted.count > 0 ? { omittedEntries: omitted } : {}),
      },
      ...(hermes === undefined ? {} : { hermes }),
    };
  } finally {
    await handle.close();
  }
}
