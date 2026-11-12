import type { NoiseThresholds } from '@usertax/core';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';
import {
  COMMENT_MARKER,
  budgetSchema,
  diffReports,
  evaluateBudgets,
  formatValue,
  renderJson,
  renderMarkdown,
} from '@usertax/core';
import type { App } from '@usertax/core';
import { BASE_SHA, lighthouseApp, mobileApp, modify, report, webApp } from './fixtures.js';

const base = report([webApp(), mobileApp()], { git: { sha: BASE_SHA } });
const head = modify(base, (r) => {
  r.git = { sha: 'c'.repeat(40) };
  const web = r.apps[0] as App;
  const main = web.assets?.[0];
  if (main) {
    main.raw += 72_000;
    main.gzip = 52_000;
    main.brotli = 45_000;
    main.packages = [...(main.packages ?? []), { name: 'moment', bytes: 72_000 }];
  }
  const archive = r.apps[1]?.archives?.[0];
  if (archive) {
    archive.fileSize += 400_000;
    archive.entries.push({
      path: 'res/drawable-xxhdpi/hero.png',
      category: 'resources',
      compressed: 400_000,
      uncompressed: 400_000,
    });
  }
});

/** Budget checks listed one by one before passed and skipped ones are only counted. */
const LISTED_BUDGET_ROWS = 20;

/** Turns the calibrated default noise thresholds off, to test unassessed changes. */
const OFF: NoiseThresholds = { performance: null, lcp: null, tbt: null, cls: null };

describe('formatValue', () => {
  it('formats each unit', () => {
    expect(formatValue(1_500, 'bytes')).toBe('1.5 kB');
    expect(formatValue(850, 'ms')).toBe('850 ms');
    expect(formatValue(2_345, 'ms')).toBe('2.35 s');
    expect(formatValue(92.5, 'score')).toBe('92.5');
    expect(formatValue(0.1234, 'unitless')).toBe('0.123');
    expect(formatValue(12.34, 'percent')).toBe('12.3%');
  });
});

describe('renderMarkdown', () => {
  it('renders a comparison with budgets', async () => {
    const diff = diffReports(head, base);
    const budgets = evaluateBudgets(diff, [
      budgetSchema.parse({ app: 'web', metric: 'js.total.gzip', maxIncrease: '10kB' }),
      budgetSchema.parse({ metric: 'archive[*].file', max: '50MB', level: 'warn' }),
      budgetSchema.parse({ metric: 'nope.*', max: 1 }),
    ]);
    const markdown = renderMarkdown(diff, {
      budgets,
      runUrl: 'https://github.com/o/r/actions/runs/1',
    });
    expect(markdown.startsWith(COMMENT_MARKER)).toBe(true);
    await expect(markdown).toMatchFileSnapshot('./__snapshots__/comparison.md');
  });

  it('lists only the package budgets that need attention when a glob checks many', () => {
    const many = modify(head, (r) => {
      const main = r.apps[0]?.assets?.[0];
      if (main) {
        main.packages = Array.from({ length: 30 }, (_, i) => ({ name: `pkg-${i}`, bytes: 1_000 }));
        main.packages.push({ name: '<img src=x onerror=alert(1)>|`x', bytes: 40_000 });
      }
    });
    const diff = diffReports(many, base);
    const budgets = evaluateBudgets(diff, [
      budgetSchema.parse({ app: 'web', metric: 'package[*].bytes', maxIncrease: '20 kB' }),
    ]);
    expect(budgets.results.length).toBeGreaterThan(LISTED_BUDGET_ROWS);
    const markdown = renderMarkdown(diff, { budgets });
    // Package metrics have their own table and never show as metric rows.
    expect(markdown).not.toContain('| Package pkg-0 (minified) |');
    const budgetRows = markdown.split('\n').filter((line) => line.includes('maxIncrease'));
    expect(budgetRows).toHaveLength(1);
    expect(budgetRows[0]).toContain('❌');
    expect(markdown).toContain(`Not listed: ${budgets.results.length - 1} passed.`);
    const html = micromark(markdown, {
      allowDangerousHtml: true,
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    expect(html).not.toMatch(/<img/);
    // The hostile name stays inside its table cell.
    const cells = /<tr>\s*<td[^>]*>❌<\/td>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
    expect(cells.match(/<td/g)).toHaveLength(5);
  });

  it('counts budget checks when none needs attention', () => {
    const diff = diffReports(head);
    const budgets = evaluateBudgets(diff, [
      budgetSchema.parse({ app: 'web', metric: 'package[*].bytes', maxIncrease: '20 kB' }),
      budgetSchema.parse({ metric: '*', max: '1 GB' }),
    ]);
    expect(budgets.results.length).toBeGreaterThan(LISTED_BUDGET_ROWS);
    const markdown = renderMarkdown(diff, { budgets });
    const passed = budgets.results.filter((r) => r.status === 'pass').length;
    const skipped = budgets.results.length - passed;
    expect(markdown).toContain(
      `${budgets.results.length} budget checks: ${passed} passed, ${skipped} skipped.`,
    );
  });

  it('renders head values when there is no base', async () => {
    await expect(renderMarkdown(diffReports(head), { marker: false })).toMatchFileSnapshot(
      './__snapshots__/head-only.md',
    );
  });

  it('renders Lighthouse spread and noise', async () => {
    const runs = (p: number[], lcp: number) => p.map((performance) => ({ performance, lcp }));
    const lhBase = report([lighthouseApp(runs([80, 81, 80, 79, 80], 2400))], {
      git: { sha: BASE_SHA },
    });
    const lhHead = report([lighthouseApp(runs([70, 72, 71, 70, 69], 2420))]);
    const diff = diffReports(lhHead, lhBase, {
      noise: { performance: { floor: 2, k: 1.5 }, lcp: { floor: 100, k: 1.5 } },
    });
    await expect(renderMarkdown(diff, { compression: 'brotli' })).toMatchFileSnapshot(
      './__snapshots__/lighthouse.md',
    );
  });

  it('renders additions, removals, improvements and omitted rows', async () => {
    const before = report(
      [
        webApp({
          assets: [
            ...(webApp().assets ?? []),
            {
              key: 'legacy.js',
              file: 'legacy-1.js',
              type: 'js',
              raw: 9_000,
              gzip: 3_000,
              brotli: 2_500,
              packages: [{ name: 'lodash', bytes: 9_000 }],
            },
          ],
        }),
        mobileApp({ id: 'old-app', name: 'old-app' }),
      ],
      { git: { sha: BASE_SHA } },
    );
    const after = modify(before, (r) => {
      r.apps = [
        r.apps[0] as App,
        mobileApp({ id: 'new-app', name: 'new-app', path: 'apps/new-app' }),
      ];
      const web = r.apps[0] as App;
      web.assets = (web.assets ?? []).filter((a) => a.key !== 'legacy.js');
      // The new route shows a hero image and a web font (route[/new].images and .fonts).
      web.assets.push(
        { key: 'assets/hero-[hash].png', file: 'assets/hero-1a2b.png', type: 'image', raw: 48_000 },
        {
          key: 'assets/inter-[hash].woff2',
          file: 'assets/inter-3c4d.woff2',
          type: 'font',
          raw: 23_000,
        },
      );
      web.routes = [
        ...(web.routes ?? []),
        {
          route: '/new',
          assets: ['assets/about-[hash].js', 'assets/hero-[hash].png', 'assets/inter-[hash].woff2'],
        },
      ];
      web.routes = web.routes.filter((route) => route.route !== '/');
      const css = web.assets.find((a) => a.type === 'css');
      if (css) css.gzip = 1_500;
    });
    const diff = diffReports(after, before, { top: 1 });
    const budgets = evaluateBudgets(diff, [
      budgetSchema.parse({
        app: 'web',
        metric: 'css.total.gzip',
        maxDecreasePercent: 10,
        level: 'warn',
      }),
      budgetSchema.parse({ app: 'web', metric: 'js.total.gzip', min: '50kB', level: 'warn' }),
    ]);
    await expect(renderMarkdown(diff, { budgets, marker: false })).toMatchFileSnapshot(
      './__snapshots__/changes.md',
    );
  });

  it('notes unassessed noise on changed metrics', () => {
    const runs = (p: number[]) => p.map((performance) => ({ performance, lcp: 2000 }));
    const diff = diffReports(
      report([lighthouseApp(runs([70, 71, 72]))]),
      report([lighthouseApp(runs([80, 81, 82]))]),
      { noise: OFF },
    );
    expect(renderMarkdown(diff)).toContain('-10 (-12.3%) <sub>noise not assessed</sub>');
  });

  it('names the previous id of an app matched by its path', () => {
    const renamed = report([webApp({ id: 'site', name: 'site' }), mobileApp()]);
    expect(renderMarkdown(diffReports(renamed, base))).toContain(
      '### site <sub>Vite · `apps/web` · id was `web`</sub>',
    );
  });

  it('suggests alternatives once for a package that changed in several bundles', () => {
    const android = mobileApp().bundles?.[0];
    if (android === undefined) throw new Error('fixture without a bundle');
    const ios = { ...android, platform: 'ios' as const, file: 'dist/ios/main.jsbundle' };
    const before = report([mobileApp({ bundles: [android, ios] })]);
    const after = modify(before, (r) => {
      for (const bundle of r.apps[0]?.bundles ?? []) {
        bundle.packages = [...(bundle.packages ?? []), { name: 'moment', bytes: 60_000 }];
      }
    });
    const markdown = renderMarkdown(diffReports(after, before));
    expect(markdown.match(/\| `moment` \|/g)).toHaveLength(2);
    expect(markdown.match(/^- `moment`:/gm)).toHaveLength(1);
  });

  it('says so when nothing changed or nothing was measured', () => {
    const empty = report([webApp({ id: 'empty', name: 'empty', assets: [], routes: [] })]);
    expect(renderMarkdown(diffReports(base, base))).toContain('_No changes._');
    expect(renderMarkdown(diffReports(empty, empty))).toContain(
      '_Nothing was measured for this app._',
    );
  });

  it('shows the warning block', () => {
    const other = modify(base, (r) => {
      r.settings.compression.gzipLevel = 6;
    });
    expect(renderMarkdown(diffReports(other, base))).toContain('> [!WARNING]');
  });

  it('neutralises hostile strings from an untrusted report', () => {
    const hostile = modify(head, (r) => {
      const web = r.apps[0] as App;
      web.name = '@everyone <img src=x onerror=alert(1)> [click](https://evil.example)';
      web.path = 'a`b|c\n<!-- usertax:report -->';
      const asset = web.assets?.[0];
      if (asset) asset.file = '`](javascript:alert(1))';
      // Route names come from build manifests and HTML; this route has JS and CSS rows.
      const route = web.routes?.[0];
      if (route) route.route = '/<img src=x onerror=alert(1)>|`x';
      r.tool.version = '1.0.0 <script>';
    });
    const markdown = renderMarkdown(diffReports(hostile, base), { runUrl: 'javascript:alert(1)' });
    // Render the way GitHub does (GFM), keeping raw HTML, and inspect the result.
    const html = micromark(markdown, {
      allowDangerousHtml: true,
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    const tags = new Set([...html.matchAll(/<([a-z][a-z0-9]*)/g)].map((m) => m[1]));
    const allowed = new Set([
      'a',
      'blockquote',
      'code',
      'details',
      'h2',
      'h3',
      'li',
      'p',
      'strong',
      'sub',
      'summary',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'ul',
    ]);
    expect([...tags].filter((tag) => tag === undefined || !allowed.has(tag))).toEqual([]);
    // Links only come from usertax's own curated data, never from the report.
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/(e18e\.dev|github\.com\/e18e)\//);
    expect(markdown).not.toContain('@everyone');
    expect(markdown).toContain('CSS for /');
    // The only HTML comment is our marker at the very start; a marker inside a code span is
    // shown as text and cannot be mistaken for the sticky-comment marker by `startsWith`.
    expect(markdown.startsWith(COMMENT_MARKER)).toBe(true);
    expect(html.match(/<!--/g)).toHaveLength(1);
  });

  it('drops details first, then whole apps, to stay under the size limit', () => {
    const many = (n: number) =>
      report(
        Array.from({ length: n }, (_, i) =>
          webApp({ id: `app-${i}`, name: `app-${i}`, path: `apps/app-${i}` }),
        ),
      );
    const bigBase = many(40);
    const bigHead = modify(bigBase, (r) => {
      for (const app of r.apps) {
        const asset = app.assets?.[0];
        if (asset) asset.gzip = 31_000;
      }
    });
    const diff = diffReports(bigHead, bigBase);
    const full = renderMarkdown(diff);

    const withoutDetails = renderMarkdown(diff, { maxLength: full.length - 1 });
    expect(withoutDetails.length).toBeLessThan(full.length);
    expect(withoutDetails).toContain("GitHub's comment size limit");
    expect(withoutDetails).toContain('`apps/app-39`');

    const fewerApps = renderMarkdown(diff, { maxLength: 4_000 });
    expect(fewerApps.length).toBeLessThanOrEqual(4_000);
    expect(fewerApps).toMatch(/_…and \d+ more apps not shown\._/);
    expect(fewerApps).toContain('`apps/app-0`');
  });
});

describe('renderJson', () => {
  it('serialises the diff and budgets', () => {
    const diff = diffReports(head, base);
    const parsed = JSON.parse(renderJson(diff)) as { diff: unknown };
    expect(parsed).toEqual({ diff: JSON.parse(JSON.stringify(diff)) as unknown });
    const budgets = evaluateBudgets(diff, []);
    expect(JSON.parse(renderJson(diff, budgets))).toHaveProperty('budgets.status', 'pass');
  });
});
