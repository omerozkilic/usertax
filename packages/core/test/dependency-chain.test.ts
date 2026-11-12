import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';
import {
  causeText,
  diffDependencies,
  diffReports,
  parseReport,
  renderMarkdown,
} from '@usertax/core';
import type { App, Dependency } from '@usertax/core';
import { BASE_SHA, modify, report, webApp } from './fixtures.js';

const moment = (extra: Partial<Dependency> = {}): Dependency => ({
  name: 'moment',
  version: '2.30.1',
  direct: false,
  via: ['react-datepicker'],
  ...extra,
});

describe('diffDependencies with chains', () => {
  it('carries the chain of an added package', () => {
    const [change] = diffDependencies([], [moment({ chain: ['react-datepicker', 'date-fns'] })]);
    expect(change).toMatchObject({ kind: 'added', via: ['react-datepicker'] });
    expect(change?.chain).toEqual(['react-datepicker', 'date-fns']);
  });

  it('has none for a direct dependency or one that a direct dependency needs itself', () => {
    expect(diffDependencies([], [moment({ direct: true })])[0]).not.toHaveProperty('chain');
    expect(diffDependencies([], [moment()])[0]).not.toHaveProperty('chain');
  });

  it('shows the shortest chain, and none when one version is closer than any chain', () => {
    const far = moment({ version: '2.0.0', chain: ['a', 'b', 'c'] });
    const near = moment({ version: '3.0.0', chain: ['x', 'y'] });
    expect(diffDependencies([], [far, near])[0]?.chain).toEqual(['x', 'y']);
    expect(diffDependencies([], [far, moment({ version: '4.0.0' })])[0]).not.toHaveProperty(
      'chain',
    );
  });

  it('keeps the chain of a removed package', () => {
    const [change] = diffDependencies([moment({ chain: ['a', 'b'] })], []);
    expect(change).toMatchObject({ kind: 'removed', chain: ['a', 'b'] });
  });
});

describe('causeText with chains', () => {
  const chain = ['react-datepicker', 'date-fns'];
  it('shows the chain from the direct dependency instead of the dependencies', () => {
    const base = { name: 'moment', base: [], head: ['2.30.1'], direct: false, dev: false };
    expect(causeText({ ...base, kind: 'added', via: ['react-datepicker'], chain })).toBe(
      'added `2.30.1` via `react-datepicker` → `date-fns`',
    );
    expect(causeText({ ...base, kind: 'added', via: ['react-datepicker'] })).toBe(
      'added `2.30.1` via `react-datepicker`',
    );
    expect(causeText({ ...base, kind: 'upgraded', base: ['2.0.0'], chain })).toBe(
      'upgraded `2.0.0` → `2.30.1` via `react-datepicker` → `date-fns`',
    );
  });
});

describe('chains in the comment', () => {
  const dependencies: Dependency[] = [
    { name: 'react', version: '19.3.1', direct: true },
    { name: 'react-datepicker', version: '8.0.0', direct: true },
    moment({ chain: ['react-datepicker', 'date-fns'] }),
  ];
  const base = report([webApp()], { git: { sha: BASE_SHA } });
  const head = modify(report([webApp()]), (r) => {
    const web = r.apps[0] as App;
    web.dependencies = dependencies;
    web.assets?.[0]?.packages?.push({ name: 'moment', bytes: 72_000 });
  });
  const withSnapshot = modify(base, (r) => {
    (r.apps[0] as App).dependencies = [{ name: 'react', version: '19.3.1', direct: true }];
  });

  it('say how the package got in, in the Why column', () => {
    expect(renderMarkdown(diffReports(head, withSnapshot), { marker: false })).toContain(
      'added `2.30.1` via `react-datepicker` → `date-fns`',
    );
  });

  it('neutralise hostile package names', () => {
    const hostile = modify(head, (r) => {
      const dep = (r.apps[0] as App).dependencies?.find((d) => d.name === 'moment');
      if (dep) dep.chain = ['x](https://evil.example)', '<img src=x onerror=alert(1)>@everyone`|'];
    });
    const markdown = renderMarkdown(diffReports(hostile, withSnapshot));
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
    expect(html.replace(/<code>[\s\S]*?<\/code>/g, '')).not.toContain('@everyone');
  });
});

describe('the report schema', () => {
  it('accepts a chain of two to ten names and rejects others', () => {
    const withChain = (chain: string[]) =>
      JSON.parse(
        JSON.stringify(
          modify(report([webApp()]), (r) => {
            (r.apps[0] as App).dependencies = [moment({ chain })];
          }),
        ),
      ) as unknown;
    expect(() => parseReport(withChain(['a', 'b']))).not.toThrow();
    expect(() =>
      parseReport(withChain(Array.from({ length: 10 }, (_, i) => `p${i}`))),
    ).not.toThrow();
    expect(() => parseReport(withChain(['a']))).toThrow();
    expect(() => parseReport(withChain(Array.from({ length: 11 }, (_, i) => `p${i}`)))).toThrow();
  });
});
