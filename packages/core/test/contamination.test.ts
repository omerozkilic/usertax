import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';
import {
  budgetSchema,
  diffReports,
  evaluateBudgets,
  parseReport,
  renderMarkdown,
} from '@usertax/core';
import type { App, Report } from '@usertax/core';
import { BASE_SHA, lighthouseApp, modify, report, webApp } from './fixtures.js';

const EXTENSION = 'chrome-extension://nojlinpnfpblhnlcjpgaeankkhjbnean';
const runs = (performance: number, lcp: number) => [1, 2, 3].map(() => ({ performance, lcp }));

const base = report([lighthouseApp(runs(90, 1800))], { git: { sha: BASE_SHA } });

/** The head report, with extensions active in every Lighthouse run. */
function contaminated(origins = [EXTENSION]): Report {
  return modify(report([lighthouseApp(runs(60, 3200))]), (r) => {
    for (const run of (r.apps[0] as App).lighthouse?.[0]?.runs ?? []) {
      run.contamination = { origins, requestCount: 4 };
    }
  });
}

const lcp = (diff: ReturnType<typeof diffReports>) =>
  diff.apps[0]?.metrics.find((m) => m.id === 'lighthouse[/][mobile].lcp');

describe('Lighthouse runs with browser extensions active', () => {
  it('make the change unreliable instead of a verdict', () => {
    const metric = lcp(diffReports(contaminated(), base));
    expect(metric).toMatchObject({
      significance: 'unreliable',
      verdict: 'unknown',
      delta: 1400,
      contamination: { head: [EXTENSION] },
    });
    expect(metric?.contamination).not.toHaveProperty('base');
  });

  it('are also unreliable when the base was the contaminated one', () => {
    const metric = lcp(diffReports(base, contaminated()));
    expect(metric?.significance).toBe('unreliable');
    expect(metric?.contamination).toEqual({ base: [EXTENSION] });
  });

  it('leave clean reports exactly as they were', () => {
    const metric = lcp(diffReports(report([lighthouseApp(runs(60, 3200))]), base));
    expect(metric?.significance).not.toBe('unreliable');
    expect(metric).not.toHaveProperty('contamination');
    expect(diffReports(report([lighthouseApp(runs(60, 3200))]), base).warnings).toEqual([]);
  });

  it('are warned about, naming the extension and the page', () => {
    const { warnings } = diffReports(contaminated(), base);
    expect(warnings).toEqual([
      `Lighthouse ran with browser extensions active on head for / (mobile) (${EXTENSION}). ` +
        'Those scores are not comparable and are not checked against budgets.',
    ]);
  });

  it('are skipped by budgets, with or without a base', () => {
    const budgets = [
      budgetSchema.parse({ metric: 'lighthouse[/][mobile].lcp', max: '2s' }),
      budgetSchema.parse({ metric: 'lighthouse[/][mobile].lcp', maxIncrease: '100ms' }),
    ];
    for (const diff of [diffReports(contaminated(), base), diffReports(contaminated())]) {
      const results = evaluateBudgets(diff, budgets).results;
      expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
      expect(results[0]?.message).toBe('skipped: Lighthouse ran with browser extensions active');
    }
    // The same budgets do judge a clean run.
    const clean = diffReports(report([lighthouseApp(runs(60, 3200))]), base);
    expect(evaluateBudgets(clean, budgets).results.map((r) => r.status)).toEqual(['fail', 'fail']);
  });

  it('are shown as not comparable in the comment', async () => {
    const diff = diffReports(contaminated(), base);
    const markdown = renderMarkdown(diff, {
      budgets: evaluateBudgets(diff, [
        budgetSchema.parse({ metric: 'lighthouse[/][mobile].lcp', max: '2s' }),
      ]),
    });
    await expect(markdown).toMatchFileSnapshot('./__snapshots__/contamination.md');
  });

  it.each([
    ['only skipped budgets are not called a pass', undefined, '⏭️ 1 budget skipped'],
    ['a pass next to a skipped budget', '1MB', '✅ 1 pass · ⏭️ 1 skipped'],
    ['a failure next to a skipped budget', '1B', '❌ 1 budget failed · ⏭️ 1 skipped'],
  ])('%s', (_name, webLimit, expected) => {
    const withWeb = (r: Report) => modify(r, (copy) => void copy.apps.push(webApp()));
    const diff = diffReports(withWeb(contaminated()), withWeb(base));
    const budgets = [
      budgetSchema.parse({ app: 'site', metric: 'lighthouse[/][mobile].lcp', max: '2s' }),
      ...(webLimit === undefined
        ? []
        : [budgetSchema.parse({ app: 'web', metric: 'js.total.gzip', max: webLimit })]),
    ];
    const markdown = renderMarkdown(diff, { budgets: evaluateBudgets(diff, budgets) });
    expect(markdown.split('\n').find((line) => line.startsWith('Base '))).toContain(expected);
  });

  it('neutralise hostile extension ids in the comment', () => {
    const hostile = contaminated([
      'chrome-extension://x](https://evil.example)<img src=x onerror=alert(1)>@everyone`|',
    ]);
    const markdown = renderMarkdown(diffReports(hostile, base));
    const html = micromark(markdown, {
      allowDangerousHtml: true,
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    const tags = new Set([...html.matchAll(/<([a-z][a-z0-9]*)/g)].map((m) => m[1]));
    for (const tag of ['img', 'script']) expect(tags.has(tag)).toBe(false);
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])).not.toContain(
      'https://evil.example',
    );
    expect(markdown).not.toContain('@everyone');
  });
});

describe('the report schema', () => {
  it('accepts the field and rejects an empty or oversized list', () => {
    expect(parseReport(JSON.parse(JSON.stringify(contaminated())))).toEqual(contaminated());
    const bad = (origins: string[]) =>
      JSON.parse(
        JSON.stringify(
          modify(contaminated(), (r) => {
            const run = (r.apps[0] as App).lighthouse?.[0]?.runs[0];
            if (run) run.contamination = { origins, requestCount: 1 };
          }),
        ),
      ) as unknown;
    expect(() => parseReport(bad([]))).toThrow();
    expect(() => parseReport(bad(Array.from({ length: 21 }, (_, i) => `ext://${i}`)))).toThrow();
  });
});
