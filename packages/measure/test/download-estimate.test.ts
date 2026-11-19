import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEVICE_PROFILES, analyzeArchive, estimateDownloads } from '@usertax/measure';

const archives = fileURLToPath(new URL('./fixtures/archives/', import.meta.url));
const benchmark = new URL(
  '../../../docs/benchmarks/data/2026-11-20-aab-bundletool/',
  import.meta.url,
);

const entry = (path: string, compressed: number) => ({ path, compressed });
const bytesOf = (downloads: ReturnType<typeof estimateDownloads>, abi: string) =>
  downloads.find((d) => d.abi === abi)?.bytes;

describe('estimateDownloads', () => {
  const entries = [
    entry('base/dex/classes.dex', 1000),
    entry('base/assets/index.android.bundle', 500),
    entry('base/resources.pb', 100),
    entry('base/manifest/AndroidManifest.xml', 10),
    entry('base/lib/arm64-v8a/libapp.so', 4000),
    entry('base/lib/armeabi-v7a/libapp.so', 3000),
    entry('feature/lib/arm64-v8a/libfeature.so', 200),
    entry('feature/dex/classes.dex', 20),
    // Not part of any split.
    entry('BUNDLE-METADATA/com.android.tools.build.debugsymbols/arm64-v8a/libapp.so.sym', 99_999),
    entry('META-INF/MANIFEST.MF', 88_888),
    entry('BundleConfig.pb', 77_777),
    // Without a density: in the base split.
    entry('base/res/layout/main.xml', 7),
    entry('base/res/mipmap-anydpi-v26/ic_launcher.xml', 3),
    // One resource in several densities: the variant of the closest density.
    entry('base/res/mipmap-mdpi-v4/ic.png', 10),
    entry('base/res/mipmap-hdpi-v4/ic.png', 20),
    entry('base/res/mipmap-xxxhdpi-v4/ic.png', 60),
    // Only in one density: always delivered.
    entry('base/res/drawable-hdpi-v4/only.png', 5),
  ];

  it('counts the base split, the ABI libraries and the closest density of each resource', () => {
    const base = 1000 + 500 + 100 + 10 + 20 + 7 + 3;
    const downloads = estimateDownloads(entries, [
      { abi: 'arm64-v8a', density: 'xxhdpi' },
      { abi: 'armeabi-v7a', density: 'mdpi' },
    ]);
    // xxhdpi: ic.png takes xxxhdpi (the next higher), only.png its hdpi variant.
    expect(bytesOf(downloads, 'arm64-v8a')).toBe(base + 4000 + 200 + 60 + 5);
    // mdpi: ic.png takes mdpi.
    expect(bytesOf(downloads, 'armeabi-v7a')).toBe(base + 3000 + 10 + 5);
  });

  it('falls back to the next lower density when no higher one exists', () => {
    const only = [entry('base/lib/arm64-v8a/a.so', 1), entry('base/res/drawable-mdpi-v4/a.png', 9)];
    expect(
      bytesOf(estimateDownloads(only, [{ abi: 'arm64-v8a', density: 'xxhdpi' }]), 'arm64-v8a'),
    ).toBe(10);
  });

  it('skips profiles without native libraries or with an unknown density', () => {
    expect(estimateDownloads(entries, [{ abi: 'x86_64', density: 'xxhdpi' }])).toEqual([]);
    expect(estimateDownloads(entries, [{ abi: 'arm64-v8a', density: 'retina' }])).toEqual([]);
    expect(estimateDownloads([entry('base/dex/classes.dex', 1)])).toEqual([]);
  });

  it('uses profiles that name a density the table knows', () => {
    for (const { abi, density } of DEVICE_PROFILES)
      expect(estimateDownloads(entries, [{ abi, density }]).length).toBeLessThanOrEqual(1);
  });
});

describe('the estimate against bundletool', () => {
  it('stays within 0.5 % of `bundletool get-size total` on a real AAB', async () => {
    const recorded = JSON.parse(await readFile(new URL('entries.json', benchmark), 'utf8')) as [
      string,
      number,
    ][];
    const result = JSON.parse(await readFile(new URL('result.json', benchmark), 'utf8')) as {
      rows: { abi: string; density: string; bundletool: number; usertax: number }[];
    };
    expect(result.rows.length).toBeGreaterThanOrEqual(10);
    const entries = recorded.map(([path, compressed]) => entry(path, compressed));
    for (const row of result.rows) {
      const [estimate] = estimateDownloads(entries, [{ abi: row.abi, density: row.density }]);
      expect(estimate?.bytes, `${row.abi} ${row.density}`).toBe(row.usertax);
      expect(Math.abs(row.usertax - row.bundletool) / row.bundletool).toBeLessThan(0.005);
    }
  });
});

describe('analyzeArchive downloads', () => {
  it('reports an estimate per device profile of an AAB that has its native libraries', async () => {
    const { archive } = await analyzeArchive({ file: `${archives}multi-abi.aab` });
    expect(archive.downloads?.map((d) => d.abi).sort()).toEqual(
      DEVICE_PROFILES.map((p) => p.abi)
        .filter((abi) => archive.abis?.some((a) => a.abi === abi))
        .sort(),
    );
    for (const download of archive.downloads ?? []) expect(download.bytes).toBeGreaterThan(0);
  });

  it('reports none for an APK or an AAB without native libraries', async () => {
    expect((await analyzeArchive({ file: `${archives}multi-abi.apk` })).archive).not.toHaveProperty(
      'downloads',
    );
    expect((await analyzeArchive({ file: `${archives}Example.ipa` })).archive).not.toHaveProperty(
      'downloads',
    );
  });
});
