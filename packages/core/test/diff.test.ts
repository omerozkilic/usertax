import type { NoiseThresholds } from '@usertax/core';
import { describe, expect, it } from 'vitest';
import { diffReports } from '@usertax/core';
import type { App, ReportDiff } from '@usertax/core';
import { BASE_SHA, lighthouseApp, mobileApp, modify, report, webApp } from './fixtures.js';

const base = report([webApp(), mobileApp()], { git: { sha: BASE_SHA } });

function metric(diff: ReportDiff, app: string, id: string) {
  return diff.apps.find((a) => a.id === app)?.metrics.find((m) => m.id === id);
}

/** Turns the calibrated default noise thresholds off, to test unassessed changes. */
const OFF: NoiseThresholds = { performance: null, lcp: null, tbt: null, cls: null };

describe('diffReports', () => {
  it('reports no changes for identical reports', () => {
    const diff = diffReports(base, base);
    expect(diff.apps.every((a) => a.status === 'compared')).toBe(true);
    expect(diff.apps.flatMap((a) => a.metrics).every((m) => m.change === 'unchanged')).toBe(true);
    expect(diff.apps.flatMap((a) => [...a.assets, ...a.packages, ...a.archiveEntries])).toEqual([]);
    expect(diff.warnings).toEqual([]);
    expect(diff.base?.sha).toBe(BASE_SHA);
  });

  it('computes deltas, percentages and verdicts for sizes', () => {
    const head = modify(base, (r) => {
      const asset = r.apps[0]?.assets?.[0];
      if (asset) {
        asset.raw += 10_000;
        asset.gzip = 33_000;
      }
    });
    const m = metric(diffReports(head, base), 'web', 'js.total.gzip');
    expect(m).toMatchObject({
      base: 34_000,
      head: 37_000,
      delta: 3_000,
      change: 'increased',
      significance: 'exact',
      verdict: 'worse',
    });
    expect(m?.percent).toBeCloseTo(8.82, 2);
  });

  it('marks decreases in lower-is-better metrics as better', () => {
    const head = modify(base, (r) => {
      const archive = r.apps[1]?.archives?.[0];
      if (archive) archive.fileSize -= 1_000_000;
    });
    expect(metric(diffReports(head, base), 'mobile', 'archive[android].file')?.verdict).toBe(
      'better',
    );
  });

  it('omits the percentage when the base is zero', () => {
    const zero = report([webApp({ assets: [{ key: 'a.js', file: 'a.js', type: 'js', raw: 0 }] })]);
    const head = report([webApp({ assets: [{ key: 'a.js', file: 'a.js', type: 'js', raw: 5 }] })]);
    const m = metric(diffReports(head, zero), 'web', 'js.total.raw');
    expect(m?.delta).toBe(5);
    expect(m).not.toHaveProperty('percent');
  });

  it('lists head values only when there is no base', () => {
    const diff = diffReports(base);
    expect(diff.base).toBeNull();
    expect(diff.apps.every((a) => a.status === 'head-only')).toBe(true);
    expect(metric(diff, 'web', 'js.total.gzip')).toMatchObject({
      change: 'added',
      significance: 'not-comparable',
      verdict: 'unknown',
    });
    expect(diff.apps[0]?.assets).toEqual([]);
  });

  it('reports apps added and removed between reports', () => {
    const head = report([webApp(), webApp({ id: 'docs', name: 'docs' })]);
    const diff = diffReports(head, base);
    expect(diff.apps.map((a) => [a.id, a.status])).toEqual([
      ['web', 'compared'],
      ['docs', 'added'],
      ['mobile', 'removed'],
    ]);
    expect(metric(diff, 'mobile', 'archive[android].file')).toMatchObject({
      change: 'removed',
      base: 30_000_000,
    });
  });

  it('reports metrics that disappear from an app', () => {
    const head = modify(base, (r) => {
      const app = r.apps[0];
      if (app) app.routes = [];
    });
    expect(metric(diffReports(head, base), 'web', 'route[/].js.gzip')?.change).toBe('removed');
  });

  it('ranks changed files by the chosen compression and counts omitted ones', () => {
    const head = modify(base, (r) => {
      const app = r.apps[0] as App;
      app.assets = [
        ...(app.assets ?? []).map((a) => ({ ...a, raw: a.raw + 1, gzip: (a.gzip ?? 0) + 1 })),
        { key: 'new.js', file: 'new-123.js', type: 'js', raw: 50, gzip: 500 },
      ];
    });
    const diff = diffReports(head, base, { top: 2, rankBy: 'gzip' });
    const assets = diff.apps[0]?.assets ?? [];
    expect(assets.map((a) => a.key)).toEqual(['new.js', 'assets/index-[hash].js']);
    expect(assets[0]).toMatchObject({ change: 'added', headFile: 'new-123.js' });
    expect(assets[0]).not.toHaveProperty('base');
    expect(diff.apps[0]?.omitted.assets).toBe(2);
  });

  it('falls back to raw deltas when a compression is missing on one side', () => {
    const head = modify(base, (r) => {
      const asset = r.apps[0]?.assets?.[1];
      if (asset) {
        delete asset.gzip;
        asset.raw += 100;
      }
    });
    const asset = diffReports(head, base).apps[0]?.assets.find((a) =>
      a.key.startsWith('assets/about'),
    );
    expect(asset?.delta).toEqual({ raw: 100, brotli: 0 });
  });

  it('reports removed files', () => {
    const head = modify(base, (r) => {
      const app = r.apps[0];
      if (app) app.assets = app.assets?.filter((a) => a.type !== 'css');
    });
    const asset = diffReports(head, base).apps[0]?.assets[0];
    expect(asset).toMatchObject({ change: 'removed', delta: { raw: -8_000, gzip: -2_000 } });
  });

  it('aggregates package sizes per scope, including first-party code', () => {
    const head = modify(base, (r) => {
      const asset = r.apps[0]?.assets?.[0];
      if (asset) asset.packages = [...(asset.packages ?? []), { name: 'moment', bytes: 70_000 }];
      const bundle = r.apps[1]?.bundles?.[0];
      if (bundle) bundle.firstPartyBytes = 210_000;
    });
    const diff = diffReports(head, base);
    expect(diff.apps[0]?.packages).toEqual([
      {
        scope: 'web',
        name: 'moment',
        base: 0,
        head: 70_000,
        delta: 70_000,
        change: 'added',
        alternatives: {
          replacements: ['day.js', 'date-fns', 'luxon', 'Date', 'Temporal'],
          url: 'https://e18e.dev/docs/replacements/moment',
          source: 'e18e/module-replacements@3.4.0',
        },
      },
    ]);
    expect(diff.apps[1]?.packages).toEqual([
      {
        scope: 'android',
        name: null,
        base: 200_000,
        head: 210_000,
        delta: 10_000,
        change: 'increased',
      },
    ]);
  });

  it('diffs archive entries only when the base has the same archive', () => {
    const head = modify(base, (r) => {
      const archive = r.apps[1]?.archives?.[0];
      if (archive) {
        archive.entries.push({
          path: 'res/drawable/hero.png',
          category: 'resources',
          compressed: 300_000,
          uncompressed: 300_000,
        });
        archive.entries = archive.entries.filter((e) => e.path !== 'classes.dex');
      }
    });
    const entries = diffReports(head, base).apps[1]?.archiveEntries ?? [];
    expect(entries.map((e) => [e.path, e.change, e.delta])).toEqual([
      ['classes.dex', 'removed', -8_000_000],
      ['res/drawable/hero.png', 'added', 300_000],
    ]);

    const renamed = modify(head, (r) => {
      const archive = r.apps[1]?.archives?.[0];
      if (archive) archive.key = 'android-release';
    });
    expect(diffReports(renamed, base).apps[1]?.archiveEntries).toEqual([]);
  });

  it('warns when measurement settings or tool versions differ', () => {
    const head = report([lighthouseApp([{ performance: 90, lcp: 2000 }])], {
      tool: { name: 'usertax', version: '1.0.0' },
      settings: { compression: { gzipLevel: 6, brotliQuality: 11 } },
    });
    const old = modify(head, (r) => {
      r.tool.version = '0.9.0';
      r.settings.compression.gzipLevel = 9;
      const entry = r.apps[0]?.lighthouse?.[0];
      if (entry) entry.lighthouseVersion = '12.0.0';
    });
    const warnings = diffReports(head, old).warnings;
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/Compression settings differ/);
    expect(warnings[1]).toMatch(/usertax 0\.9\.0/);
    expect(warnings[2]).toMatch(/Lighthouse versions differ/);
  });
});

describe('diffReports noise model', () => {
  const runs = (performance: number[]) => performance.map((p) => ({ performance: p, lcp: 2000 }));
  const lhBase = report([lighthouseApp(runs([80, 82, 81, 79, 80]))]);
  const id = 'lighthouse[/][mobile].performance';

  it('leaves noisy metrics unassessed without a threshold', () => {
    const head = report([lighthouseApp(runs([70, 71, 72, 70, 69]))]);
    const m = metric(diffReports(head, lhBase, { noise: OFF }), 'site', id);
    expect(m).toMatchObject({ significance: 'unassessed', verdict: 'unknown', delta: -10 });
    expect(m?.spread?.base?.n).toBe(5);
  });

  it('flags changes beyond the threshold as significant', () => {
    const head = report([lighthouseApp(runs([70, 71, 72, 70, 69]))]);
    const m = metric(
      diffReports(head, lhBase, { noise: { performance: { floor: 3, k: 1.5 } } }),
      'site',
      id,
    );
    expect(m).toMatchObject({ significance: 'significant', verdict: 'worse', threshold: 3 });
  });

  it('treats changes below the threshold as noise', () => {
    const head = report([lighthouseApp(runs([79, 81, 80, 78, 79]))]);
    const m = metric(
      diffReports(head, lhBase, { noise: { performance: { floor: 3, k: 1.5 } } }),
      'site',
      id,
    );
    expect(m).toMatchObject({ significance: 'within-noise', verdict: 'neutral' });
  });

  it('scales the threshold with the pooled IQR', () => {
    const wide = report([lighthouseApp(runs([60, 70, 80, 90, 100]))]);
    const m = metric(
      diffReports(wide, lhBase, { noise: { performance: { floor: 1, k: 1 } } }),
      'site',
      id,
    );
    // base IQR 1 (80 → 81), head IQR 20 (70 → 90) → pooled 10.5
    expect(m?.threshold).toBe(10.5);
  });
});
