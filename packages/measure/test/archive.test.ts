import { open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ArchiveError,
  analyzeArchive,
  categorize,
  isHermesBytecode,
  readEntryPrefix,
  readZipEntries,
} from '@usertax/measure';

const dir = fileURLToPath(new URL('./fixtures/archives/', import.meta.url));
const hbc = await readFile(new URL('./fixtures/hermes/index.android.hbc', import.meta.url));

function categories(archive: {
  categories: { category: string; compressed: number; count: number }[];
}) {
  return Object.fromEntries(archive.categories.map((c) => [c.category, c.count]));
}

describe('analyzeArchive', () => {
  it('breaks an APK down by category and detects a Hermes bundle', async () => {
    const { archive, hermes } = await analyzeArchive({ file: `${dir}app-release.apk` });
    expect(archive).toMatchObject({
      key: 'android',
      file: 'app-release.apk',
      format: 'apk',
      platform: 'android',
      entryCount: 11,
    });
    expect(categories(archive)).toEqual({
      dex: 2,
      native: 2,
      resources: 3,
      'js-bundle': 1,
      assets: 1,
      other: 2,
    });
    expect(hermes).toBe(true);
    const total = archive.categories.reduce((sum, c) => sum + c.compressed, 0);
    const listed =
      archive.entries.reduce((sum, e) => sum + e.compressed, 0) +
      (archive.omittedEntries?.compressed ?? 0);
    expect(listed).toBe(total);
    expect(archive.fileSize).toBeGreaterThan(total);
    expect(archive.entries[0]?.compressed).toBeGreaterThanOrEqual(
      archive.entries.at(-1)?.compressed ?? 0,
    );
  });

  it('reads AAB modules and a JavaScript (non-Hermes) bundle', async () => {
    const { archive, hermes } = await analyzeArchive({
      file: `${dir}app-release.aab`,
      key: 'play',
    });
    expect(archive).toMatchObject({ key: 'play', format: 'aab', platform: 'android' });
    expect(categories(archive)).toEqual({
      dex: 1,
      native: 1,
      resources: 2,
      'js-bundle': 1,
      assets: 1,
      other: 3,
    });
    expect(hermes).toBe(false);
  });

  it('reads an IPA', async () => {
    const { archive, hermes } = await analyzeArchive({ file: `${dir}Example.ipa` });
    expect(archive).toMatchObject({ key: 'ios', format: 'ipa', platform: 'ios' });
    expect(categories(archive)).toEqual({
      binary: 1,
      frameworks: 1,
      'js-bundle': 1,
      assets: 2,
      resources: 2,
      other: 1,
    });
    expect(hermes).toBe(true);
  });

  it('reads ZIP64 archives and detects the format from the contents', async () => {
    const { archive, hermes } = await analyzeArchive({ file: `${dir}zip64-ipa` });
    expect(archive.format).toBe('ipa');
    expect(categories(archive)).toEqual({ binary: 1, 'js-bundle': 1 });
    expect(hermes).toBe(true); // stored entry
  });

  it('finds the end of central directory before an archive comment', async () => {
    const { archive } = await analyzeArchive({ file: `${dir}commented`, minEntryBytes: 0 });
    expect(archive.entryCount).toBe(2);
    expect(archive).not.toHaveProperty('omittedEntries');
  });

  it('rejects files that are not archives', async () => {
    await expect(analyzeArchive({ file: `${dir}not-a-zip.apk` })).rejects.toThrow(
      /not a ZIP archive/,
    );
    await expect(analyzeArchive({ file: `${dir}missing.apk` })).rejects.toThrow(
      /cannot open .*ENOENT/,
    );
    await expect(analyzeArchive({ file: `${dir}generate.py` })).rejects.toBeInstanceOf(
      ArchiveError,
    );
  });
});

describe('readEntryPrefix', () => {
  it('reads stored and deflated entries and skips other methods', async () => {
    const handle = await open(`${dir}app-release.apk`, 'r');
    try {
      const entries = await readZipEntries(handle, (await handle.stat()).size);
      const bundle = entries.find((e) => e.path === 'assets/index.android.bundle');
      const arsc = entries.find((e) => e.path === 'resources.arsc');
      if (bundle === undefined || arsc === undefined) throw new Error('fixture changed');
      expect(await readEntryPrefix(handle, bundle, 8)).toEqual(hbc.subarray(0, 8));
      expect((await readEntryPrefix(handle, arsc, 4))?.length).toBe(4);
      expect(await readEntryPrefix(handle, { ...bundle, method: 12 })).toBeUndefined();
      expect(await readEntryPrefix(handle, { ...bundle, localHeaderOffset: 1 })).toBeUndefined();
    } finally {
      await handle.close();
    }
  });
});

describe('categorize', () => {
  it.each([
    ['apk', 'classes12.dex', 'dex'],
    ['apk', 'lib/x86_64/libfoo.so', 'native'],
    ['apk', 'assets/index.android.bundle', 'js-bundle'],
    ['apk', 'kotlin/kotlin.kotlin_builtins', 'other'],
    ['aab', 'feature/dex/classes.dex', 'dex'],
    ['aab', 'base/assets/index.android.bundle', 'js-bundle'],
    ['ipa', 'Payload/A.app/PlugIns/Widget.appex/Widget', 'frameworks'],
    ['ipa', 'Payload/A.app/Base.lproj/Main.storyboardc/x.nib', 'resources'],
    ['ipa', 'Payload/A.app/sound.mp3', 'assets'],
    ['ipa', 'Symbols/x', 'other'],
  ] as const)('%s %s → %s', (format, path, category) => {
    expect(categorize(format, path)).toBe(category);
  });
});

describe('isHermesBytecode', () => {
  it('checks the magic number', () => {
    expect(isHermesBytecode(hbc)).toBe(true);
    expect(isHermesBytecode(Buffer.from('var x = 1;'))).toBe(false);
    expect(isHermesBytecode(undefined)).toBe(false);
    expect(isHermesBytecode(hbc.subarray(0, 4))).toBe(false);
  });
});
