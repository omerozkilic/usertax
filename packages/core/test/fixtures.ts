import type { App, Report } from '@usertax/core';

export const BASE_SHA = 'a'.repeat(40);
export const HEAD_SHA = 'b'.repeat(40);

export function report(apps: App[], overrides: Partial<Report> = {}): Report {
  return {
    schemaVersion: 1,
    tool: { name: 'usertax', version: '0.1.0' },
    createdAt: '2026-11-03T12:00:00.000Z',
    git: { sha: HEAD_SHA, ref: 'refs/heads/feature' },
    settings: { compression: { gzipLevel: 9, brotliQuality: 11 } },
    apps,
    ...overrides,
  };
}

export function webApp(overrides: Partial<App> = {}): App {
  return {
    id: 'web',
    name: 'web',
    path: 'apps/web',
    kind: 'web',
    framework: 'vite',
    assets: [
      {
        key: 'assets/index-[hash].js',
        file: 'assets/index-1a2b3c.js',
        type: 'js',
        raw: 100_000,
        gzip: 30_000,
        brotli: 26_000,
        packages: [
          { name: 'react-dom', bytes: 60_000 },
          { name: 'react', bytes: 5_000 },
        ],
        firstPartyBytes: 35_000,
      },
      {
        key: 'assets/about-[hash].js',
        file: 'assets/about-9f8e7d.js',
        type: 'js',
        raw: 10_000,
        gzip: 4_000,
        brotli: 3_500,
        firstPartyBytes: 10_000,
      },
      {
        key: 'assets/index-[hash].css',
        file: 'assets/index-55aa.css',
        type: 'css',
        raw: 8_000,
        gzip: 2_000,
        brotli: 1_800,
      },
    ],
    routes: [
      { route: '/', assets: ['assets/index-[hash].js', 'assets/index-[hash].css'] },
      { route: '/about', assets: ['assets/index-[hash].js', 'assets/about-[hash].js'] },
    ],
    ...overrides,
  };
}

export function mobileApp(overrides: Partial<App> = {}): App {
  return {
    id: 'mobile',
    name: 'mobile',
    path: 'apps/mobile',
    kind: 'react-native',
    framework: 'expo',
    bundles: [
      {
        platform: 'android',
        file: 'dist/_expo/static/js/android/index.hbc',
        format: 'hermes',
        raw: 2_000_000,
        packages: [{ name: 'react-native', bytes: 500_000 }],
        firstPartyBytes: 200_000,
      },
    ],
    archives: [
      {
        key: 'android',
        file: 'app-release.apk',
        format: 'apk',
        platform: 'android',
        fileSize: 30_000_000,
        entryCount: 3,
        categories: [
          { category: 'dex', compressed: 8_000_000, uncompressed: 16_000_000, count: 1 },
          { category: 'js-bundle', compressed: 1_000_000, uncompressed: 2_000_000, count: 1 },
          { category: 'native', compressed: 20_000_000, uncompressed: 40_000_000, count: 1 },
        ],
        entries: [
          { path: 'classes.dex', category: 'dex', compressed: 8_000_000, uncompressed: 16_000_000 },
          {
            path: 'assets/index.android.bundle',
            category: 'js-bundle',
            compressed: 1_000_000,
            uncompressed: 2_000_000,
          },
          {
            path: 'lib/arm64-v8a/libhermes.so',
            category: 'native',
            compressed: 20_000_000,
            uncompressed: 40_000_000,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function lighthouseApp(runs: { performance: number; lcp: number }[]): App {
  return webApp({
    id: 'site',
    name: 'site',
    path: 'apps/site',
    framework: 'next',
    assets: [],
    routes: [],
    lighthouse: [
      {
        url: '/',
        formFactor: 'mobile',
        lighthouseVersion: '13.6.0',
        runs: runs.map((run) => ({ ...run, tbt: 100, cls: 0.01 })),
      },
    ],
  });
}

/** Deep clone with a modification, for building head reports from base reports. */
export function modify<T>(value: T, change: (copy: T) => void): T {
  const copy = structuredClone(value);
  change(copy);
  return copy;
}
