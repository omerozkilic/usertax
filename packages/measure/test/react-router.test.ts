import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  manifestRoutes,
  measureWebApp,
  parseReactRouterManifest,
  reactRouterRoutes,
  scanOutputDir,
} from '@usertax/measure';

const spa = new URL('./fixtures/react-router-dist/', import.meta.url);
const ssr = new URL('./fixtures/react-router-ssr-dist/', import.meta.url);
const path = (url: URL) => url.pathname.replace(/\/$/, '');

type Routes = Record<string, Record<string, unknown>>;

function manifestText(routes: Routes, entry: Record<string, unknown> = {}): string {
  const withModules = Object.fromEntries(
    Object.entries(routes).map(([id, route]) => [id, { id, module: `/assets/${id}.js`, ...route }]),
  );
  return `window.__reactRouterManifest=${JSON.stringify({
    entry: { module: '/assets/entry.js', imports: [], css: [], ...entry },
    routes: withModules,
    url: '/assets/manifest.js',
    version: '1',
  })};`;
}

function pages(routes: Routes) {
  const manifest = parseReactRouterManifest(manifestText(routes));
  return manifestRoutes(manifest as NonNullable<typeof manifest>).map((p) => [
    p.route,
    p.chain.map((r) => r.id),
  ]);
}

describe('parseReactRouterManifest', () => {
  it('reads the entry and every route with its modules', () => {
    const manifest = parseReactRouterManifest(
      manifestText(
        { root: { path: '', imports: ['/assets/a.js'] }, home: { parentId: 'root', index: true } },
        { imports: ['/assets/b.js'], css: ['/assets/c.css'] },
      ),
    );
    expect(manifest?.entry).toEqual({
      module: '/assets/entry.js',
      imports: ['/assets/b.js'],
      css: ['/assets/c.css'],
    });
    expect([...(manifest?.routes.keys() ?? [])]).toEqual(['root', 'home']);
    expect(manifest?.routes.get('home')).toMatchObject({ parentId: 'root', index: true });
    expect(manifest?.routes.get('root')?.imports).toEqual(['/assets/a.js']);
  });

  it.each([
    ['text without the assignment', '{"entry":{},"routes":{}}'],
    ['broken JSON', 'window.__reactRouterManifest={"entry":;'],
    ['no entry', 'window.__reactRouterManifest={"routes":{}};'],
    ['an entry without a module', 'window.__reactRouterManifest={"entry":{},"routes":{}};'],
    [
      'routes as an array',
      'window.__reactRouterManifest={"entry":{"module":"/a.js"},"routes":[]};',
    ],
    ['null', 'window.__reactRouterManifest=null;'],
  ])('gives nothing for %s', (_name, text) => {
    expect(parseReactRouterManifest(text)).toBeUndefined();
  });

  it('skips routes without a module and ignores values of the wrong type', () => {
    const text = `window.__reactRouterManifest=${JSON.stringify({
      entry: { module: '/e.js', imports: ['/a.js', 1, null], css: 'no' },
      routes: {
        bad: { id: 'bad' },
        odd: { id: 'odd', module: '/o.js', path: 5, index: 'yes', parentId: 1, imports: 'no' },
        none: 3,
      },
    })};`;
    const manifest = parseReactRouterManifest(text);
    expect(manifest?.entry).toEqual({ module: '/e.js', imports: ['/a.js'], css: [] });
    expect([...(manifest?.routes.keys() ?? [])]).toEqual(['odd']);
    expect(manifest?.routes.get('odd')).toEqual({
      id: 'odd',
      module: '/o.js',
      imports: [],
      css: [],
    });
  });
});

describe('manifestRoutes', () => {
  it('names a page by the paths from the root down, and an index route by its parent', () => {
    expect(
      pages({
        root: { path: '' },
        home: { parentId: 'root', index: true },
        about: { parentId: 'root', path: 'about' },
        blog: { parentId: 'root', path: 'blog' },
        'blog/index': { parentId: 'blog', index: true },
        'blog/post': { parentId: 'blog', path: ':slug' },
        files: { parentId: 'root', path: 'files/*' },
      }),
    ).toEqual([
      ['/', ['root', 'home']],
      ['/about', ['root', 'about']],
      ['/blog', ['root', 'blog', 'blog/index']],
      ['/blog/:slug', ['root', 'blog', 'blog/post']],
      ['/files/*', ['root', 'files']],
    ]);
  });

  it('passes through pathless layouts and leaves out routes that render nothing', () => {
    expect(
      pages({
        root: { path: '' },
        layout: { parentId: 'root' },
        dashboard: { parentId: 'layout', path: 'dashboard' },
        resource: { parentId: 'root' },
      }),
    ).toEqual([['/dashboard', ['root', 'layout', 'dashboard']]]);
  });

  it('stops at a loop in the parents and at a missing parent', () => {
    expect(pages({ a: { parentId: 'b', path: 'a' }, b: { parentId: 'a', path: 'b' } })).toEqual([]);
    expect(pages({ lone: { parentId: 'missing', path: 'x' } })).toEqual([['/x', ['lone']]]);
  });

  it('stays fast on a hostile manifest', () => {
    const routes: Routes = {};
    for (let i = 0; i < 20_000; i += 1) {
      routes[`r${i}`] = { parentId: i === 0 ? undefined : `r${i - 1}`, path: `p${i}` };
    }
    const started = performance.now();
    pages(routes);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('reactRouterRoutes on real builds', () => {
  async function routes(dir: URL) {
    const scan = await scanOutputDir({ outDir: path(dir), appDir: path(dir) });
    return reactRouterRoutes(path(dir), scan.keys);
  }
  const expected = (page: string) =>
    [
      'assets/entry.client-[hash].js',
      'assets/jsx-runtime-[hash].js',
      'assets/root-[hash].js',
      `assets/${page}-[hash].js`,
    ].sort();

  /** A copy of the prerendered build without its manifest. */
  async function withoutManifest() {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-rr-'));
    await cp(spa, dir, { recursive: true });
    for (const file of await readdir(join(dir, 'assets'))) {
      if (file.startsWith('manifest-')) await rm(join(dir, 'assets', file));
    }
    return dir;
  }

  it('lists the entry, the root and the page for a prerendered app', async () => {
    const found = await routes(spa);
    expect(found?.map((r) => r.route)).toEqual(['/', '/about']);
    expect(found?.[0]?.assets.sort()).toEqual(expected('home'));
    expect(found?.[1]?.assets.sort()).toEqual(expected('about'));
  });

  it('lists the same for a server-rendered app, which has no HTML pages at all', async () => {
    expect((await readdir(path(ssr))).filter((f) => f.endsWith('.html'))).toEqual([]);
    const found = await routes(ssr);
    expect(found?.map((r) => r.route)).toEqual(['/', '/about']);
    expect(found?.[0]?.assets.sort()).toEqual(expected('home'));
  });

  it('finds nothing without a manifest', async () => {
    const dir = await withoutManifest();
    const scan = await scanOutputDir({ outDir: dir, appDir: dir });
    expect(await reactRouterRoutes(dir, scan.keys)).toBeUndefined();
  });

  it('measures an app with routes, packages and no warning about the manifest', async () => {
    const { app, warnings } = await measureWebApp({
      id: 'rr',
      name: 'rr',
      appDir: path(spa),
      path: '.',
      outDir: path(spa),
      framework: 'react-router',
    });
    expect(app.routes?.map((r) => r.route)).toEqual(['/', '/about']);
    const names = new Set(app.assets?.flatMap((a) => a.packages?.map((p) => p.name) ?? []));
    for (const name of ['react-dom', 'react-router', 'react']) expect(names.has(name)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('falls back to the prerendered pages when the manifest is gone', async () => {
    const dir = await withoutManifest();
    const { app } = await measureWebApp({
      id: 'rr',
      name: 'rr',
      appDir: dir,
      path: '.',
      outDir: dir,
      framework: 'react-router',
    });
    // __spa-fallback.html is the host's fallback page, not a route.
    expect(app.routes?.map((r) => r.route)).toEqual(['/', '/about/']);
  });
});
