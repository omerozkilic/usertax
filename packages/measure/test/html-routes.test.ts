import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  htmlRoutes,
  measureWebApp,
  pageRoute,
  referencedUrls,
  resolveUrl,
  scanOutputDir,
  staticImports,
} from '@usertax/measure';

const astro = new URL('./fixtures/astro-dist/', import.meta.url);
const sveltekit = new URL('./fixtures/sveltekit-dist/', import.meta.url);
const nuxt = new URL('./fixtures/nuxt-dist/', import.meta.url);
const path = (url: URL) => url.pathname.replace(/\/$/, '');

describe('pageRoute', () => {
  it.each([
    ['index.html', '/'],
    ['about/index.html', '/about/'],
    ['docs/guide/index.html', '/docs/guide/'],
    ['about.html', '/about'],
    ['blog/post.html', '/blog/post'],
  ])('%s → %s', (file, route) => {
    expect(pageRoute(file)).toBe(route);
  });
});

describe('referencedUrls', () => {
  it('reads scripts, stylesheets and module preloads, however the attributes are quoted', () => {
    const html = `<head>
      <script type="module" src="/a.js"></script>
      <script src='/b.js' defer></script>
      <script src=/c.js></script>
      <link rel="stylesheet" href="/d.css">
      <link href="./e.js" rel="modulepreload">
      <link rel="preload" as="script" href="/f.js">
      <link rel="preload" as="style" href="/g.css">
    </head>`;
    expect(referencedUrls(html)).toEqual([
      '/a.js',
      '/b.js',
      '/c.js',
      '/d.css',
      './e.js',
      '/f.js',
      '/g.css',
    ]);
  });

  it('ignores prefetches, data attributes and JSON payloads, which are not loaded with the page', () => {
    const html = `<link rel="prefetch" as="script" href="/lazy.js">
      <link rel="preload" as="fetch" crossorigin href="/_payload.json">
      <script type="application/json" data-src="/_payload.json" data-nuxt-data="nuxt-app"></script>
      <script type="module" src="/entry.js"></script>
      <x-island data-component-url="/not-an-island.js" component-url="/island.js"></x-island>`;
    expect(referencedUrls(html)).toEqual(['/entry.js', '/island.js']);
  });

  it('ignores icons, fonts, images and scripts without a source', () => {
    const html = `<link rel="icon" href="/favicon.ico"><link rel="preload" as="font" href="/x.woff2">
      <link rel="preload" as="image" href="/hero.png"><link rel="canonical" href="/page">
      <script>console.log("src=/not-a-url.js")</script>`;
    expect(referencedUrls(html)).toEqual([]);
  });

  it('reads the island attributes of Astro and the import() calls of inline scripts', () => {
    const html = `<astro-island component-url="/_astro/Counter.js" renderer-url="/_astro/client.js"
      before-hydration-url="/_astro/before.js"></astro-island>
      <script>import("./_app/start.js").then(async (k) => { await import('./_app/app.js'); });</script>`;
    expect(referencedUrls(html).sort()).toEqual([
      './_app/app.js',
      './_app/start.js',
      '/_astro/Counter.js',
      '/_astro/before.js',
      '/_astro/client.js',
    ]);
  });

  it('stays fast on hostile markup', () => {
    const started = performance.now();
    referencedUrls(`<script ${'a'.repeat(300_000)}`);
    referencedUrls('<link rel="stylesheet" '.repeat(20_000));
    referencedUrls(`component-url="${'x'.repeat(300_000)}`);
    referencedUrls(`import(\`${'x'.repeat(300_000)}`);
    referencedUrls(`<script src="${'y'.repeat(300_000)}`);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('staticImports', () => {
  it('reads every static form and leaves dynamic imports, bare specifiers and strings alone', () => {
    const code = [
      'const __vite__mapDeps=(i)=>i;',
      'import{a as b}from"./named.js";import c from"./default.js";',
      'import * as d from "../namespace.js";import e,{f}from"./both.js";',
      'import"./bare.js";export*from"./reexport.js";export{g}from"/rooted.js";',
      'import h from"react";import{i}from"@scope/pkg";',
      'export default"./not-an-import.js";export{j};',
      'const k=()=>import("./dynamic.js");',
      'const text="import x from \'./in-a-string.js\'";',
    ].join('\n');
    expect(staticImports(code).sort()).toEqual([
      '../namespace.js',
      './bare.js',
      './both.js',
      './default.js',
      './named.js',
      './reexport.js',
      '/rooted.js',
    ]);
  });

  it('reads the real chunks of an Astro island and a SvelteKit entry', async () => {
    const read = (url: URL, file: string) => readFile(new URL(file, url), 'utf8');
    expect(staticImports(await read(astro, '_astro/Counter.DdXgDww-.js'))).toEqual([
      './hooks.BBRV89oA.js',
      './preact.Cqu7G1k0.js',
    ]);
    // `client` also imports signals.module.js, but through import(): it loads later.
    expect(staticImports(await read(astro, '_astro/client.Zhk-N1eU.js'))).toEqual([
      './preact.Cqu7G1k0.js',
    ]);
    expect(
      staticImports(await read(sveltekit, '_app/immutable/entry/start.C82xWFgg.js')).sort(),
    ).toEqual(['../chunks/DclECHGd.js', './payload.DSmR2FwN.js']);
  });

  it('stays fast on hostile code', () => {
    const started = performance.now();
    staticImports('import{'.repeat(60_000));
    staticImports('}import{'.repeat(60_000));
    staticImports(`;import${' '.repeat(400_000)}`);
    staticImports(`import{${'a,'.repeat(150_000)}`);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('resolveUrl', () => {
  const files = new Set(['_app/a.js', 'assets/b.js', 'x y.js', '_astro/c.js']);

  it.each([
    ['./_app/a.js', '.', '_app/a.js'],
    ['/_app/a.js', 'docs', '_app/a.js'],
    ['../assets/b.js', 'docs', 'assets/b.js'],
    ['./a.js', '_app', '_app/a.js'],
    ['/_app/a.js?v=1#top', '.', '_app/a.js'],
    ['/x%20y.js', '.', 'x y.js'],
    ['/docs/_astro/c.js', '.', '_astro/c.js'],
    ['/a/b/c/_app/a.js', '.', '_app/a.js'],
  ])('%s from %s', (url, dir, expected) => {
    expect(resolveUrl(url, dir, files)).toBe(expected);
  });

  it.each([
    'https://cdn.example.com/a.js',
    '//cdn.example.com/a.js',
    'data:text/javascript,1',
    '../../outside.js',
    '/missing.js',
    '/%E0%A4%A.js',
  ])('finds nothing for %s', (url) => {
    expect(resolveUrl(url, '.', files)).toBeUndefined();
  });
});

describe('htmlRoutes on real builds', () => {
  async function routes(dir: URL) {
    const scan = await scanOutputDir({ outDir: path(dir), appDir: path(dir) });
    return htmlRoutes(path(dir), scan.keys);
  }

  it('lists the files an Astro page loads: the island, its renderer and their imports', async () => {
    const found = await routes(astro);
    expect(found?.map((r) => r.route)).toEqual(['/', '/about/']);
    expect(found?.[0]?.assets.sort()).toEqual([
      '_astro/Counter.[hash].js',
      '_astro/client.[hash].js',
      '_astro/hooks.[hash].js',
      '_astro/preact.[hash].js',
    ]);
    // Its only script is inline, so nothing but the HTML is loaded.
    expect(found?.[1]?.assets).toEqual([]);
  });

  it('lists the files a SvelteKit page preloads, which differ only in their page node', async () => {
    const found = await routes(sveltekit);
    expect(found?.map((r) => r.route)).toEqual(['/', '/about']);
    const [home, about] = found ?? [];
    expect(home?.assets).toHaveLength(9);
    expect(about?.assets).toHaveLength(9);
    const own = (assets: string[] | undefined, other: string[] | undefined) =>
      (assets ?? []).filter((key) => !(other ?? []).includes(key));
    expect(own(home?.assets, about?.assets)).toEqual(['_app/immutable/nodes/2.[hash].js']);
    expect(own(about?.assets, home?.assets)).toEqual(['_app/immutable/nodes/3.[hash].js']);
  });

  it('lists the entry and page chunk of a Nuxt page, not its prefetched lazy chunks', async () => {
    const found = await routes(nuxt);
    // 200.html and 404.html are the fallback pages of a static host, not routes.
    expect(found?.map((r) => r.route)).toEqual(['/', '/about/']);
    const [home, about] = found ?? [];
    expect(home?.assets).toEqual(['_nuxt/IBdXmKL5.js', '_nuxt/BxnytY3l.js']);
    expect(about?.assets).toHaveLength(9);
    const own = (assets: string[] | undefined, other: string[] | undefined) =>
      (assets ?? []).filter((key) => !(other ?? []).includes(key));
    expect(own(home?.assets, about?.assets)).toEqual(['_app/immutable/nodes/2.[hash].js']);
    expect(own(about?.assets, home?.assets)).toEqual(['_app/immutable/nodes/3.[hash].js']);
  });

  it('lists the entry and page chunk of a Nuxt page, not its prefetched lazy chunks', async () => {
    const found = await routes(nuxt);
    // 200.html and 404.html are the fallback pages of a static host, not routes.
    expect(found?.map((r) => r.route)).toEqual(['/', '/about/']);
    const [home, about] = found ?? [];
    expect(home?.assets).toEqual(
      ['_nuxt/IBdXmKL5.[hash].js', '_nuxt/BxnytY3l.[hash].js'].map((k) => k.replace('.[hash]', '')),
    );
    expect(about?.assets).toEqual(['_nuxt/IBdXmKL5.js', '_nuxt/lBV859Qk.js']);
  });

  it('finds no routes without HTML pages', async () => {
    const scan = await scanOutputDir({
      outDir: path(new URL('_astro/', astro)),
      appDir: path(astro),
    });
    expect(await htmlRoutes(path(new URL('_astro/', astro)), scan.keys)).toBeUndefined();
  });

  it.each([
    ['astro', astro, ['preact', '@astrojs/preact-renderer', '@preact/signals']],
    ['sveltekit', sveltekit, ['svelte', '@sveltejs/kit', 'devalue']],
    ['nuxt', nuxt, ['nuxt', 'vue-router', '@vue/runtime-core']],
  ] as const)('measures a %s app with routes and packages', async (framework, dir, packages) => {
    const { app } = await measureWebApp({
      id: framework,
      name: framework,
      appDir: path(dir),
      path: '.',
      outDir: path(dir),
      framework,
    });
    expect(app.framework).toBe(framework);
    expect(app.routes).toHaveLength(2);
    const names = new Set(app.assets?.flatMap((a) => a.packages?.map((p) => p.name) ?? []));
    for (const name of packages) expect(names.has(name)).toBe(true);
  });
});
