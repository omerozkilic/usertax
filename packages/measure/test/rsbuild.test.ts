import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureWebApp } from '@usertax/measure';

const outDir = fileURLToPath(new URL('./fixtures/rsbuild-dist/', import.meta.url));

describe('measureWebApp on a real Rsbuild 2 build', () => {
  it('measures every file with stable keys, exact attribution and routes per HTML page', async () => {
    const { app, warnings } = await measureWebApp({
      id: 'rsbuild-app',
      name: 'rsbuild-app',
      appDir: join(outDir, '..'),
      path: 'examples/rsbuild-app',
      outDir,
      framework: 'rsbuild',
    });
    expect(warnings).toEqual([]);
    // Maps and the extracted license comments are not shipped files.
    expect(app.assets?.map((a) => a.key)).toEqual([
      'about.html',
      'index.html',
      'static/css/about.[hash].css',
      'static/css/index.[hash].css',
      'static/js/about.[hash].js',
      'static/js/async/u.[hash].js',
      'static/js/index.[hash].js',
      'static/js/lib-react.[hash].js',
    ]);
    for (const asset of app.assets ?? []) {
      if (asset.type !== 'js') continue;
      const packages = (asset.packages ?? []).reduce((sum, p) => sum + p.bytes, 0);
      expect(packages + (asset.firstPartyBytes ?? 0) + (asset.unattributedBytes ?? 0)).toBe(
        asset.raw,
      );
    }
    const vendor = app.assets?.find((a) => a.key === 'static/js/lib-react.[hash].js');
    expect(vendor?.packages?.map((p) => p.name).sort()).toEqual([
      'react',
      'react-dom',
      'scheduler',
    ]);
    const entry = app.assets?.find((a) => a.key === 'static/js/index.[hash].js');
    expect(entry?.modules?.map((m) => m.path)).toContain('src/App.jsx');
    // Rspack's runtime is not shown as first-party source files.
    const paths = (entry?.modules ?? []).map((m) => m.path);
    expect(paths.filter((p) => p.startsWith('runtime/'))).toEqual([]);
    expect(paths.some((p) => p.startsWith('(virtual) webpack/runtime/'))).toBe(true);
    // The lazy chunk loads later, so it is not part of a route.
    expect(app.routes).toEqual([
      {
        route: '/',
        assets: [
          'static/js/lib-react.[hash].js',
          'static/js/index.[hash].js',
          'static/css/index.[hash].css',
        ],
      },
      {
        route: '/about',
        assets: [
          'static/js/lib-react.[hash].js',
          'static/js/about.[hash].js',
          'static/css/about.[hash].css',
        ],
      },
    ]);
  });
});
