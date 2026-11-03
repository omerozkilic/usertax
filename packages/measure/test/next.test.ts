import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlAssets, htmlRoute, measureNextApp, nextKeys } from '@usertax/measure';
import type { Asset } from '@usertax/core';

const outDir = fileURLToPath(new URL('./fixtures/next-dist/', import.meta.url));
const options = (dir: string) => ({
  id: 'next-app',
  name: 'next-app',
  appDir: join(dir, '..'),
  path: 'examples/next-app',
  outDir: dir,
  framework: 'next' as const,
});

describe('htmlRoute', () => {
  it.each([
    ['index.html', '/'],
    ['about.html', '/about'],
    ['blog/post.html', '/blog/post'],
    ['(marketing)/pricing.html', '/pricing'],
    ['docs/index.html', '/docs/'],
  ])('%s → %s', (file, route) => {
    expect(htmlRoute(file)).toBe(route);
  });

  it.each(['_not-found.html', '404.html', '500.html', 'x/_global-error.html'])(
    'skips %s',
    (file) => {
      expect(htmlRoute(file)).toBeUndefined();
    },
  );
});

describe('htmlAssets', () => {
  it('collects scripts, script preloads and stylesheets, without legacy polyfills', () => {
    const html = [
      '<link rel="stylesheet" href="/_next/static/css/a.css"/>',
      '<link rel="preload" as="script" href="/_next/static/chunks/p.js"/>',
      '<link rel="preload" as="font" href="/_next/static/media/f.woff2"/>',
      '<script src="/_next/static/chunks/a.js" async=""></script>',
      '<script src="/_next/static/chunks/legacy.js" noModule=""></script>',
      '<script src="https://cdn.example/x.js"></script>',
      '<script>inline()</script>',
      '<script src="/_next/static/chunks/a.js?dpl=1"></script>',
    ].join('');
    expect(htmlAssets(html)).toEqual(['css/a.css', 'chunks/p.js', 'chunks/a.js']);
  });
});

describe('nextKeys', () => {
  const asset = (file: string, top?: string): Asset => ({
    key: file,
    file,
    type: 'js',
    raw: 10,
    ...(top === undefined ? {} : { modules: [{ path: top, bytes: 10 }] }),
  });

  it('names hash-only chunks after their largest module', () => {
    const keys = nextKeys(
      [
        asset('chunks/3inebcps20pg4.js', 'node_modules/next/x.js'),
        asset('chunks/0cz1d0mv5g_q7.js'),
        asset('chunks/turbopack-0zq_vp9s-5ndp.js'),
        asset('chunks/app/page-named.js'),
        asset('BUILDID/_buildManifest.js'),
      ],
      'BUILDID',
    );
    expect(Object.fromEntries(keys)).toEqual({
      'chunks/3inebcps20pg4.js': 'chunks/[node_modules/next/x.js].js',
      'chunks/0cz1d0mv5g_q7.js': 'chunks/[hash].js',
      'chunks/turbopack-0zq_vp9s-5ndp.js': 'chunks/[turbopack-runtime].js',
      'chunks/app/page-named.js': 'chunks/app/page-named.js',
      'BUILDID/_buildManifest.js': '[build-id]/_buildManifest.js',
    });
  });

  it('disambiguates chunks with the same largest module', () => {
    const keys = nextKeys(
      [asset('chunks/aaaa1111.js', 'src/x.js'), asset('chunks/bbbb2222.js', 'src/x.js')],
      undefined,
    );
    expect([...keys.values()].sort()).toEqual(['chunks/[src/x.js].js', 'chunks/[src/x.js].js~2']);
  });
});

describe('measureNextApp on a real Next.js 16 build', () => {
  it('measures static chunks with exact attribution and routes from prerendered pages', async () => {
    const { app, warnings } = await measureNextApp(options(outDir));
    expect(app.framework).toBe('next');
    expect(app.routes?.map((r) => r.route)).toEqual(['/', '/about', '/counter']);
    const keys = new Set(app.assets?.map((a) => a.key));
    for (const route of app.routes ?? []) {
      expect(route.assets.length).toBeGreaterThan(0);
      for (const key of route.assets) expect(keys.has(key)).toBe(true);
    }
    // The counter page loads one more chunk: its client component.
    const counter = app.routes?.find((r) => r.route === '/counter');
    expect(counter?.assets).toContain('chunks/[examples/next-app/app/counter/Counter.jsx].js');
    for (const asset of app.assets ?? []) {
      if (asset.type !== 'js' || asset.packages === undefined) continue;
      const total =
        asset.packages.reduce((s, p) => s + p.bytes, 0) +
        (asset.firstPartyBytes ?? 0) +
        (asset.unattributedBytes ?? 0);
      expect(total).toBe(asset.raw);
    }
    // Only the legacy polyfill chunk is big enough to warn about a missing map.
    expect(warnings).toEqual([
      {
        file: 'chunks/0cz1d0mv5g_q7.js',
        message: 'no source map found; packages and modules are not attributed',
      },
    ]);
  });

  it('falls back to client reference manifests for pages without HTML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-next-'));
    await cp(outDir, dir, { recursive: true });
    await rm(join(dir, 'server/app/counter.html'));
    const { app } = await measureNextApp(options(dir));
    const counter = app.routes?.find((r) => r.route === '/counter');
    expect(counter?.assets).toContain('chunks/[examples/next-app/app/counter/Counter.jsx].js');
    expect(counter?.assets).toContain('chunks/[turbopack-runtime].js');
  });

  it('copes with a missing build id and build manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-next-'));
    await cp(outDir, dir, { recursive: true });
    await rm(join(dir, 'BUILD_ID'));
    await rm(join(dir, 'build-manifest.json'));
    const { app } = await measureNextApp(options(dir));
    expect(app.assets?.some((a) => a.key.startsWith('[build-id]/'))).toBe(false);
    expect(app.routes).toHaveLength(3);
  });
});
