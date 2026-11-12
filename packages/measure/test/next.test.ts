import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlAssets, htmlRoute, measureNextApp, nextKeys } from '@usertax/measure';
import { extractMetrics } from '@usertax/core';
import type { App, Asset } from '@usertax/core';

const outDir = fileURLToPath(new URL('./fixtures/next-dist/', import.meta.url));
const options = (dir: string) => ({
  id: 'next-app',
  name: 'next-app',
  appDir: join(dir, '..'),
  path: 'examples/next-app',
  outDir: dir,
  framework: 'next' as const,
});

/** Keys of the stylesheets a route loads. */
function cssKeys(app: App, route: string): string[] {
  const css = new Set(app.assets?.filter((a) => a.type === 'css').map((a) => a.key));
  const keys = app.routes?.find((r) => r.route === route)?.assets ?? [];
  return keys.filter((key) => css.has(key)).sort();
}

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
  it('finds the static files after a basePath, in a real build', async () => {
    // examples/next-app built with basePath: '/omer-website' (fixtures/README.md).
    const html = await readFile(
      new URL('./fixtures/next-basepath/index.html', import.meta.url),
      'utf8',
    );
    const files = htmlAssets(html);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith('chunks/') || f.startsWith('css/'))).toBe(true);
    expect(htmlAssets(html.replaceAll('/omer-website/_next/', '/_next/'))).toEqual(files);
  });

  it('finds the static files behind an assetPrefix and ignores query strings and hashes', () => {
    const html = [
      '<script src="https://cdn.example.com/_next/static/chunks/a.js?dpl=1" async=""></script>',
      '<link rel="stylesheet" href="//cdn.example.com/app/_next/static/css/b.css#x"/>',
      '<script src="/scripts/analytics.js"></script>',
    ].join('');
    expect(htmlAssets(html)).toEqual(['chunks/a.js', 'css/b.css']);
  });

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

  it('keeps the stable part of webpack chunk names', () => {
    const keys = nextKeys(
      [
        asset('chunks/framework-df4c685bfa2a539c.js', 'node_modules/react-dom/x.js'),
        asset('chunks/42cfba27-6cf1496adca048aa.js', 'node_modules/next/x.js'),
        asset('chunks/app/counter/page-72762fc6a63d5a42.js', 'app/counter/Counter.jsx'),
        asset('chunks/app/page-a0e18fd15371eacd.js'),
        asset('chunks/app/layout-a0e18fd15371eacd.js'),
      ],
      undefined,
    );
    expect(Object.fromEntries(keys)).toEqual({
      'chunks/framework-df4c685bfa2a539c.js': 'chunks/framework-[hash].js',
      'chunks/42cfba27-6cf1496adca048aa.js': 'chunks/42cfba27-[hash].js',
      'chunks/app/counter/page-72762fc6a63d5a42.js': 'chunks/app/counter/page-[hash].js',
      'chunks/app/page-a0e18fd15371eacd.js': 'chunks/app/page-[hash].js',
      'chunks/app/layout-a0e18fd15371eacd.js': 'chunks/app/layout-[hash].js',
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

  it('records the stylesheets of each route: the layout CSS, plus a CSS module on /counter', async () => {
    const { app } = await measureNextApp(options(outDir));
    const cssOf = (route: string) => cssKeys(app, route);
    expect(cssOf('/')).toHaveLength(1);
    expect(cssOf('/about')).toEqual(cssOf('/'));
    expect(cssOf('/counter')).toHaveLength(2);
    expect(cssOf('/counter')).toEqual(expect.arrayContaining(cssOf('/')));
    const metrics = new Map(extractMetrics(app).map((m) => [m.id, m.value]));
    const raw = (keys: string[]) =>
      keys.reduce((sum, key) => sum + (app.assets?.find((a) => a.key === key)?.raw ?? 0), 0);
    expect(metrics.get('route[/counter].css.raw')).toBe(raw(cssOf('/counter')));
    expect(metrics.get('route[/counter].css.raw')).toBeGreaterThan(
      metrics.get('route[/].css.raw') ?? Infinity,
    );
  });

  it('reads the stylesheets of pages without HTML from the client reference manifest', async () => {
    const withHtml = cssKeys((await measureNextApp(options(outDir))).app, '/counter');
    const dir = await mkdtemp(join(tmpdir(), 'usertax-next-'));
    await cp(outDir, dir, { recursive: true });
    await rm(join(dir, 'server/app/counter.html'));
    const { app } = await measureNextApp(options(dir));
    expect(cssKeys(app, '/counter')).toEqual(withHtml);
  });

  it('skips inlined and malformed stylesheet entries in a client reference manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-next-'));
    await cp(outDir, dir, { recursive: true });
    await rm(join(dir, 'server/app/counter.html'));
    const file = join(dir, 'server/app/counter/page_client-reference-manifest.js');
    const text = await readFile(file, 'utf8');
    const [layoutCss, moduleCss] = [...new Set(text.match(/static\/chunks\/[\w-]+\.css/g))];
    const json = JSON.parse(/=\s*(\{[\s\S]*\});?\s*$/.exec(text)?.[1] ?? '{}') as {
      entryCSSFiles: Record<string, unknown>;
    };
    json.entryCSSFiles = {
      // Next.js 14 listed plain paths.
      a: [layoutCss],
      b: [{ path: moduleCss, inlined: true }, { path: 42 }, null, 'static/chunks/missing.css'],
      c: 'not a list',
    };
    await writeFile(file, `globalThis.m = ${JSON.stringify(json)};`);
    const { app } = await measureNextApp(options(dir));
    expect(cssKeys(app, '/counter')).toHaveLength(1);
    expect(cssKeys(app, '/counter')).toEqual(cssKeys(app, '/'));
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

describe('measureNextApp on a real Next.js 16 webpack build', () => {
  const webpackDir = fileURLToPath(new URL('./fixtures/next-webpack-dist/', import.meta.url));

  it('keys chunks by name and keeps Next.js internals out of first-party code', async () => {
    const { app, warnings } = await measureNextApp(options(webpackDir));
    expect(warnings).toEqual([]);
    // The fixture leaves out the large shared chunks, so routes list only the files present.
    expect(app.routes).toEqual([
      { route: '/', assets: ['chunks/webpack-[hash].js', 'chunks/main-app-[hash].js'] },
      { route: '/about', assets: ['chunks/webpack-[hash].js', 'chunks/main-app-[hash].js'] },
      {
        route: '/counter',
        assets: [
          'chunks/webpack-[hash].js',
          'chunks/main-app-[hash].js',
          'chunks/app/counter/page-[hash].js',
        ],
      },
    ]);
    const byKey = new Map(app.assets?.map((a) => [a.key, a]));
    const counter = byKey.get('chunks/app/counter/page-[hash].js');
    expect(counter?.modules?.map((m) => m.path)).toEqual([
      'app/counter/Counter.jsx',
      '(virtual) webpack',
    ]);
    // `_not-found` is Next.js code mapped to `../../../../src/client/…`: unattributed.
    const notFound = byKey.get('chunks/app/_not-found/page-[hash].js');
    expect(notFound?.modules?.every((m) => m.path.startsWith('(virtual) '))).toBe(true);
    expect(notFound?.unattributedBytes).toBeGreaterThan(notFound?.firstPartyBytes ?? 0);
    for (const asset of app.assets ?? []) {
      if (asset.packages === undefined) continue;
      const total =
        asset.packages.reduce((sum, p) => sum + p.bytes, 0) +
        (asset.firstPartyBytes ?? 0) +
        (asset.unattributedBytes ?? 0);
      expect(total).toBe(asset.raw);
    }
  });
});
