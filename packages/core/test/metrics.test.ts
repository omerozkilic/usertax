import { describe, expect, it } from 'vitest';
import { extractMetrics } from '@usertax/core';
import { lighthouseApp, mobileApp, webApp } from './fixtures.js';

function byId(app: Parameters<typeof extractMetrics>[0]) {
  return new Map(extractMetrics(app).map((m) => [m.id, m]));
}

describe('extractMetrics', () => {
  it('sums JS and CSS per compression', () => {
    const metrics = byId(webApp());
    expect(metrics.get('js.total.raw')?.value).toBe(110_000);
    expect(metrics.get('js.total.gzip')?.value).toBe(34_000);
    expect(metrics.get('js.total.brotli')?.value).toBe(29_500);
    expect(metrics.get('css.total.gzip')?.value).toBe(2_000);
    expect(metrics.get('js.total.gzip')).toMatchObject({
      group: 'web',
      unit: 'bytes',
      direction: 'lower-is-better',
      compression: 'gzip',
    });
  });

  it('computes JS per route from the route asset list', () => {
    const metrics = byId(webApp());
    expect(metrics.get('route[/].js.gzip')?.value).toBe(30_000);
    expect(metrics.get('route[/about].js.gzip')?.value).toBe(34_000);
    expect(metrics.get('route[/about].js.gzip')?.label).toBe('JS for /about');
  });

  it('computes CSS per route only for routes that load a stylesheet', () => {
    const metrics = byId(webApp());
    expect(metrics.get('route[/].css.gzip')).toMatchObject({
      value: 2_000,
      label: 'CSS for /',
      group: 'route',
      compression: 'gzip',
    });
    // /about loads no stylesheet: no CSS rows, so reports of apps without CSS do not change.
    expect([...metrics.keys()].filter((id) => id.startsWith('route[/about].css'))).toEqual([]);
  });

  it('sums minified package bytes per app, and per platform for mobile bundles', () => {
    const web = webApp();
    const second = web.assets?.[1];
    if (second) second.packages = [{ name: 'react', bytes: 1_000 }];
    const metrics = byId(web);
    expect(metrics.get('package[react-dom].bytes')).toMatchObject({
      value: 60_000,
      group: 'package',
      unit: 'bytes',
      label: 'Package react-dom (minified)',
      packageScope: 'web',
    });
    expect(metrics.get('package[react].bytes')?.value).toBe(6_000);
    expect(metrics.get('package[react].bytes')?.compression).toBeUndefined();
    // First-party code is not a package.
    expect([...metrics.keys()].filter((id) => id.startsWith('package[null]'))).toEqual([]);
    const mobile = byId(mobileApp());
    expect(mobile.get('package[react-native][android].bytes')).toMatchObject({
      value: 500_000,
      label: 'Package react-native (Android, minified)',
    });
  });

  it('ignores unknown and duplicate asset keys in routes', () => {
    const metrics = byId(
      webApp({
        routes: [
          { route: '/x', assets: ['missing', 'assets/about-[hash].js', 'assets/about-[hash].js'] },
        ],
      }),
    );
    expect(metrics.get('route[/x].js.raw')?.value).toBe(10_000);
  });

  it('omits a compression when some asset lacks it', () => {
    const app = webApp();
    const asset = app.assets?.[1];
    if (asset) delete asset.brotli;
    const metrics = byId(app);
    expect(metrics.has('js.total.brotli')).toBe(false);
    expect(metrics.has('js.total.gzip')).toBe(true);
  });

  it('reports mobile bundles and archive categories', () => {
    const metrics = byId(mobileApp());
    expect(metrics.get('bundle[android].raw')).toMatchObject({
      value: 2_000_000,
      label: 'Android JS bundle (Hermes bytecode)',
      group: 'bundle',
    });
    expect(metrics.get('archive[android].file')).toMatchObject({
      value: 30_000_000,
      label: 'Android APK (android)',
    });
    expect(metrics.get('archive[android].category.dex')?.value).toBe(8_000_000);
  });

  it('labels plain JS bundles', () => {
    const app = mobileApp();
    const bundle = app.bundles?.[0];
    if (bundle) {
      bundle.format = 'js';
      bundle.platform = 'ios';
    }
    expect(byId(app).get('bundle[ios].raw')?.label).toBe('iOS JS bundle (JS)');
  });

  it('uses per-metric medians of Lighthouse runs and keeps the samples', () => {
    const metrics = byId(
      lighthouseApp([
        { performance: 90, lcp: 2000 },
        { performance: 70, lcp: 2600 },
        { performance: 80, lcp: 2100 },
      ]),
    );
    const performance = metrics.get('lighthouse[/][mobile].performance');
    expect(performance).toMatchObject({
      value: 80,
      samples: [90, 70, 80],
      direction: 'higher-is-better',
      noiseKey: 'performance',
      unit: 'score',
    });
    expect(metrics.get('lighthouse[/][mobile].lcp')?.value).toBe(2100);
    expect(metrics.get('lighthouse[/][mobile].cls')?.unit).toBe('unitless');
  });

  it('returns nothing for an app without measurements', () => {
    expect(extractMetrics(webApp({ assets: [], routes: [] }))).toEqual([]);
  });
});
