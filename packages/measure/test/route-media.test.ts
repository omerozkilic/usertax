import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMetrics } from '@usertax/core';
import type { App } from '@usertax/core';
import {
  measureNextApp,
  measureWebApp,
  pageMediaUrls,
  stylesheetMediaUrls,
} from '@usertax/measure';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

function metrics(app: App) {
  return new Map(extractMetrics(app).map((m) => [m.id, m.value]));
}

/** Files of a route's assets of one type. */
function filesOf(app: App, route: string, type: 'image' | 'font'): string[] {
  const keys = new Set(app.routes?.find((r) => r.route === route)?.assets);
  return (app.assets ?? [])
    .filter((a) => a.type === type && keys.has(a.key))
    .map((a) => a.file)
    .sort();
}

function bytesOf(app: App, files: readonly string[]): number {
  return (app.assets ?? []).filter((a) => files.includes(a.file)).reduce((s, a) => s + a.raw, 0);
}

describe('stylesheetMediaUrls', () => {
  it('takes the first source of each @font-face rule and every other url()', () => {
    const css = [
      '@font-face{font-family:A;src:url(a.woff2) format("woff2"),url(a.woff) format("woff")}',
      "@font-face { font-family: B; font-display: swap; src: url('b.woff2') }",
      '@font-face{font-family:C;src:local(Arial)}',
      '.hero{background:url("/img/hero.png") no-repeat}',
      '.icon{mask:url( icon.svg )}',
    ].join('\n');
    expect(stylesheetMediaUrls(css)).toEqual(['a.woff2', 'b.woff2', '/img/hero.png', 'icon.svg']);
  });

  it('stays fast on hostile stylesheets', () => {
    const start = performance.now();
    stylesheetMediaUrls(`${'url('.repeat(50_000)}${'@font-face{'.repeat(20_000)}`);
    stylesheetMediaUrls(`url(${'a'.repeat(200_000)}`);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('pageMediaUrls', () => {
  it('reads images, posters, icons, preloads and inline styles', () => {
    const html = [
      '<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/a.css">',
      '<link rel="preload" href="/f.woff2" as="font" crossorigin>',
      '<link rel="preload" href="/s.js" as="script">',
      '<picture><source srcset="/hero.avif" type="image/avif"><img src="/hero.png" alt=""></picture>',
      "<img srcset='/w-320.png 320w, /w-640.png 640w' alt=''>",
      '<video poster="/poster.jpg"></video>',
      '<STYLE>.x{background:url(/bg.webp)}</STYLE>',
    ].join('');
    expect(pageMediaUrls(html)).toEqual([
      '/favicon.svg',
      '/f.woff2',
      '/hero.png',
      '/w-320.png',
      '/poster.jpg',
      '/bg.webp',
    ]);
  });

  it('stays fast on hostile pages', () => {
    const start = performance.now();
    pageMediaUrls(`${'<img src='.repeat(50_000)}${'<style>'.repeat(20_000)}`);
    pageMediaUrls(`<style>${'url('.repeat(50_000)}`);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('route images and fonts on real builds', () => {
  it('Vite: the imported image and the first source of each Inter subset', async () => {
    const outDir = fixture('vite-dist');
    const { app } = await measureWebApp({
      id: 'vite-app',
      name: 'vite-app',
      appDir: join(outDir, '..'),
      path: 'examples/vite-app',
      outDir,
      framework: 'vite',
    });
    const images = filesOf(app, '/', 'image');
    const fonts = filesOf(app, '/', 'font');
    expect(images).toEqual([expect.stringMatching(/^assets\/hero-[\w-]+\.png$/)]);
    // @fontsource/inter declares seven unicode-range subsets, woff2 first, woff as fallback.
    expect(fonts).toHaveLength(7);
    expect(fonts.every((file) => file.endsWith('.woff2'))).toBe(true);
    const values = metrics(app);
    expect(values.get('route[/].images.bytes')).toBe(bytesOf(app, images));
    expect(values.get('route[/].fonts.bytes')).toBe(bytesOf(app, fonts));
    expect(values.get('route[/].images.bytes')).toBeGreaterThan(0);
    // The about page imports neither.
    expect(values.has('route[/about/].images.bytes')).toBe(false);
    expect(values.has('route[/about/].fonts.bytes')).toBe(false);
  });

  it('Next.js: the font of the layout on every page, the image on /about', async () => {
    const outDir = fixture('next-dist');
    const { app } = await measureNextApp({
      id: 'next-app',
      name: 'next-app',
      appDir: join(outDir, '..'),
      path: 'examples/next-app',
      outDir,
      framework: 'next',
    });
    for (const route of ['/', '/about', '/counter']) {
      expect(filesOf(app, route, 'font')).toEqual([
        expect.stringMatching(/^media\/Geist_Variable-[\w.-]+\.woff2$/),
      ]);
    }
    expect(filesOf(app, '/about', 'image')).toEqual([
      expect.stringMatching(/^media\/hero\.[\w-]+\.png$/),
    ]);
    expect(filesOf(app, '/', 'image')).toEqual([]);
    const values = metrics(app);
    expect(values.get('route[/about].images.bytes')).toBe(
      bytesOf(app, filesOf(app, '/about', 'image')),
    );
    expect(values.get('route[/].fonts.bytes')).toBeGreaterThan(0);
    expect(values.has('route[/].images.bytes')).toBe(false);
  });
});
