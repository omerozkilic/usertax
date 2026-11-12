import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseReport } from '@usertax/core';
import {
  assetType,
  createReport,
  entryRoute,
  measureWebApp,
  scanOutputDir,
  viteRoutes,
} from '@usertax/measure';

const outDir = fileURLToPath(new URL('./fixtures/vite-dist/', import.meta.url));
const appDir = join(outDir, '..');

describe('assetType', () => {
  it.each([
    ['a.js', 'js'],
    ['a.MJS', 'js'],
    ['a.css', 'css'],
    ['a.woff2', 'font'],
    ['a.svg', 'image'],
    ['a.wasm', 'wasm'],
    ['a.txt', 'other'],
    ['LICENSE', 'other'],
  ])('%s is %s', (path, type) => {
    expect(assetType(path)).toBe(type);
  });
});

describe('entryRoute', () => {
  it.each([
    ['index.html', '/'],
    ['about/index.html', '/about/'],
    ['contact.html', '/contact.html'],
    ['src/main.ts', 'src/main.ts'],
  ])('%s → %s', (src, route) => {
    expect(entryRoute(src)).toBe(route);
  });
});

describe('scanOutputDir on a real Vite build', () => {
  it('measures shipped files only, with stable keys and exact attribution', async () => {
    const { assets, warnings } = await scanOutputDir({ outDir, appDir });
    expect(warnings).toEqual([]);
    const media = assets.filter((a) => a.type === 'image' || a.type === 'font');
    expect(assets.filter((a) => !media.includes(a)).map((a) => a.key)).toEqual([
      'about/index.html',
      'assets/Details-[hash].js',
      'assets/about-[hash].js',
      'assets/main-[hash].js',
      'assets/main-[hash].css',
      'assets/styles-[hash].js',
      'assets/styles-[hash].css',
      'index.html',
    ]);
    // The hero image, and Inter in seven subsets, each as woff2 and woff (@fontsource/inter).
    expect(media.filter((a) => a.type === 'image').map((a) => a.key)).toEqual([
      'assets/hero-[hash].png',
    ]);
    expect(media.filter((a) => a.file.endsWith('.woff2'))).toHaveLength(7);
    expect(media.filter((a) => a.file.endsWith('.woff'))).toHaveLength(7);
    for (const asset of assets) {
      const bytes = await readFile(join(outDir, asset.file));
      expect(asset.raw).toBe(bytes.byteLength);
      if (asset.type === 'js') {
        const packages = (asset.packages ?? []).reduce((sum, p) => sum + p.bytes, 0);
        expect(packages + (asset.firstPartyBytes ?? 0) + (asset.unattributedBytes ?? 0)).toBe(
          asset.raw,
        );
      }
    }
    const app = assets.find((a) => a.key === 'assets/main-[hash].js');
    // `src/hero.png` is the module that exports the image's URL.
    expect(app?.modules?.map((m) => m.path)).toEqual([
      'src/App.jsx',
      'src/main.jsx',
      'src/hero.png',
    ]);
  });

  it('limits the module list', async () => {
    const { assets } = await scanOutputDir({ outDir, appDir, maxModules: 1 });
    expect(assets.every((a) => (a.modules?.length ?? 0) <= 1)).toBe(true);
  });
});

describe('viteRoutes', () => {
  it('lists the initial files of each HTML entry', async () => {
    const { keys } = await scanOutputDir({ outDir, appDir });
    expect(await viteRoutes(outDir, keys)).toEqual([
      {
        route: '/',
        // The image comes from the manifest (`assets` of the chunk); fonts from the stylesheets.
        assets: [
          'assets/main-[hash].js',
          'assets/main-[hash].css',
          'assets/hero-[hash].png',
          'assets/styles-[hash].js',
          'assets/styles-[hash].css',
        ],
      },
      {
        route: '/about/',
        assets: ['assets/about-[hash].js', 'assets/styles-[hash].js', 'assets/styles-[hash].css'],
      },
    ]);
  });

  it('returns undefined without a manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-web-'));
    expect(await viteRoutes(dir, new Map())).toBeUndefined();
  });
});

describe('source map discovery', () => {
  async function build(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-maps-'));
    for (const [name, content] of Object.entries(files)) {
      await mkdir(join(dir, name, '..'), { recursive: true });
      await writeFile(join(dir, name), content);
    }
    return (await scanOutputDir({ outDir: dir, appDir: dir })).assets.concat();
  }
  const sourceMap = JSON.stringify({ version: 3, sources: ['src/a.js'], mappings: 'AAAA' });

  it('follows a sourceMappingURL comment', async () => {
    const [asset] = await build({
      'a.js': 'var a=1;\n//# sourceMappingURL=maps/a.map',
      'maps/a.map': sourceMap,
    });
    expect(asset?.modules?.[0]?.path).toBe('maps/src/a.js');
  });

  it('reads inline base64 maps', async () => {
    const inline = Buffer.from(sourceMap).toString('base64');
    const [asset] = await build({
      'a.js': `var a=1;\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${inline}`,
    });
    expect(asset?.firstPartyBytes).toBe(8);
  });

  it('warns about missing, unsupported and broken maps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-warn-'));
    await writeFile(join(dir, 'none.js'), 'x'.repeat(2048));
    await writeFile(join(dir, 'tiny.js'), 'x'); // too small to warn about
    await writeFile(join(dir, 'inline.js'), '//# sourceMappingURL=data:text/plain,abc');
    await writeFile(join(dir, 'broken.js'), 'x');
    await writeFile(join(dir, 'broken.js.map'), '{');
    const { warnings } = await scanOutputDir({ outDir: dir, appDir: dir });
    expect(warnings).toEqual([
      { file: 'broken.js', message: 'source map ignored: source map is not valid JSON' },
      { file: 'inline.js', message: 'source map ignored: unsupported inline source map encoding' },
      { file: 'none.js', message: 'no source map found; packages and modules are not attributed' },
    ]);
  });

  it('skips files that are not shipped', async () => {
    const assets = await build({
      'a.js': 'x',
      '.vite/manifest.json': '{}',
      'a.js.map': sourceMap,
      'vendor.js.LICENSE.txt': 'MIT',
    });
    expect(assets.map((a) => a.file)).toEqual(['a.js']);
  });
});

describe('measureWebApp and createReport', () => {
  it('produces a valid report for the Vite build', async () => {
    const { app, warnings } = await measureWebApp({
      id: 'vite-app',
      name: 'vite-app',
      appDir,
      path: 'examples/vite-app',
      outDir,
      framework: 'vite',
    });
    expect(warnings).toEqual([]);
    expect(app.routes).toHaveLength(2);
    const report = createReport({
      apps: [app],
      toolVersion: '0.0.0',
      sha: 'f'.repeat(40),
      ref: 'refs/heads/main',
      createdAt: new Date('2026-11-03T00:00:00Z'),
    });
    expect(parseReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(report.git).toEqual({ sha: 'f'.repeat(40), ref: 'refs/heads/main' });
    expect(report.settings.compression).toEqual({ gzipLevel: 9, brotliQuality: 11 });
  });

  it('omits routes for frameworks without a manifest adapter', async () => {
    const { app } = await measureWebApp({
      id: 's',
      name: 's',
      appDir,
      path: '.',
      outDir,
      framework: 'static',
    });
    expect(app).not.toHaveProperty('routes');
    expect(createReport({ apps: [app], toolVersion: '0.0.0' })).not.toHaveProperty('git');
  });
});
