import { describe, expect, it } from 'vitest';
import {
  ALTERNATIVES_SOURCE,
  alternativesFor,
  causeText,
  compareVersions,
  diffDependencies,
  diffReports,
  renderMarkdown,
} from '@usertax/core';
import type { App, Dependency } from '@usertax/core';
import { BASE_SHA, modify, report, webApp } from './fixtures.js';

describe('compareVersions', () => {
  it.each([
    ['1.2.3', '1.2.3', 0],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-rc.2', '1.0.0-rc.10', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['v1.2.3', '1.2.3', 0],
    ['1.0.0+build.1', '1.0.0', 0],
    ['github:a/b', 'github:a/c', -1],
  ])('%s vs %s → %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('diffDependencies', () => {
  const dep = (name: string, version: string, extra: Partial<Dependency> = {}): Dependency => ({
    name,
    version,
    direct: true,
    ...extra,
  });

  it('classifies changes per package', () => {
    const base = [
      dep('react', '19.2.0'),
      dep('lodash', '4.17.21'),
      dep('ms', '2.1.2'),
      dep('dup', '1.0.0'),
      dep('same', '1.0.0'),
    ];
    const head = [
      dep('react', '19.3.1'),
      dep('moment', '2.30.1', { direct: false, via: ['lib'] }),
      dep('ms', '2.1.1'),
      dep('dup', '1.0.0'),
      dep('dup', '2.0.0', { direct: false, via: ['x'] }),
      dep('same', '1.0.0'),
      dep('vite', '8.3.5', { dev: true }),
    ];
    expect(diffDependencies(base, head)).toEqual([
      {
        name: 'dup',
        kind: 'changed',
        base: ['1.0.0'],
        head: ['1.0.0', '2.0.0'],
        direct: true,
        dev: false,
        via: ['x'],
      },
      { name: 'lodash', kind: 'removed', base: ['4.17.21'], head: [], direct: true, dev: false },
      {
        name: 'moment',
        kind: 'added',
        base: [],
        head: ['2.30.1'],
        direct: false,
        dev: false,
        via: ['lib'],
      },
      {
        name: 'ms',
        kind: 'downgraded',
        base: ['2.1.2'],
        head: ['2.1.1'],
        direct: true,
        dev: false,
      },
      {
        name: 'react',
        kind: 'upgraded',
        base: ['19.2.0'],
        head: ['19.3.1'],
        direct: true,
        dev: false,
      },
      { name: 'vite', kind: 'added', base: [], head: ['8.3.5'], direct: true, dev: true },
    ]);
  });

  it('handles missing snapshots', () => {
    expect(diffDependencies(undefined, undefined)).toEqual([]);
    expect(diffDependencies(undefined, [dep('a', '1.0.0')])[0]?.kind).toBe('added');
  });
});

describe('alternativesFor', () => {
  it('returns curated alternatives with their source', () => {
    expect(alternativesFor('moment')).toEqual({
      replacements: ['day.js', 'date-fns', 'luxon', 'Date', 'Temporal'],
      url: 'https://e18e.dev/docs/replacements/moment',
      source: `e18e/module-replacements@${ALTERNATIVES_SOURCE.version}`,
    });
  });

  it('has no suggestion for unknown packages or object prototype keys', () => {
    expect(alternativesFor('react')).toBeUndefined();
    expect(alternativesFor('constructor')).toBeUndefined();
    expect(alternativesFor('__proto__')).toBeUndefined();
  });

  it('cites an MIT-licensed source', () => {
    expect(ALTERNATIVES_SOURCE).toMatchObject({ name: 'e18e/module-replacements', license: 'MIT' });
  });
});

describe('causeText', () => {
  it('describes every cause', () => {
    expect(causeText(undefined)).toBe('–');
    expect(causeText({ kind: 'no-version-change' })).toBe(
      'same version; more or less of it is imported',
    );
    const base = { name: 'x', direct: true, dev: false } as const;
    expect(causeText({ ...base, kind: 'added', base: [], head: ['1.0.0'] })).toBe(
      'added `1.0.0` (direct)',
    );
    expect(
      causeText({
        ...base,
        direct: false,
        kind: 'added',
        base: [],
        head: ['1.0.0'],
        via: ['a', 'b'],
      }),
    ).toBe('added `1.0.0` via `a`, `b`');
    expect(causeText({ ...base, kind: 'removed', base: ['1.0.0'], head: [] })).toBe(
      'removed `1.0.0` (direct)',
    );
    expect(causeText({ ...base, direct: false, kind: 'removed', base: ['1.0.0'], head: [] })).toBe(
      'removed `1.0.0`',
    );
    expect(causeText({ ...base, kind: 'upgraded', base: ['1.0.0'], head: ['2.0.0'] })).toBe(
      'upgraded `1.0.0` → `2.0.0`',
    );
    expect(
      causeText({
        ...base,
        direct: false,
        kind: 'downgraded',
        base: ['2.0.0'],
        head: ['1.0.0'],
        via: ['p'],
      }),
    ).toBe('downgraded `2.0.0` → `1.0.0` via `p`');
    expect(causeText({ ...base, kind: 'changed', base: ['1.0.0'], head: ['1.0.0', '2.0.0'] })).toBe(
      'versions `1.0.0` → `1.0.0`, `2.0.0`',
    );
  });
});

describe('attribution in diffs and comments', () => {
  const baseApp = webApp({
    dependencies: [
      { name: 'react', version: '19.2.0', direct: true },
      { name: 'react-dom', version: '19.2.0', direct: true },
      { name: 'vite', version: '8.3.4', direct: true, dev: true },
    ],
  });
  const base = report([baseApp], { git: { sha: BASE_SHA } });
  const head = modify(base, (r) => {
    const app = r.apps[0] as App;
    const main = app.assets?.[0];
    if (main) {
      main.raw += 80_000;
      main.packages = [
        { name: 'react-dom', bytes: 61_000 },
        { name: 'react', bytes: 5_000 },
        { name: 'moment', bytes: 72_000 },
        { name: 'clsx', bytes: 400 },
      ];
    }
    app.dependencies = [
      { name: 'clsx', version: '2.1.1', direct: true },
      { name: 'moment', version: '2.30.1', direct: false, via: ['@acme/dates'] },
      { name: 'react', version: '19.2.0', direct: true },
      { name: 'react-dom', version: '19.3.1', direct: true },
      { name: 'vite', version: '8.3.5', direct: true, dev: true },
    ];
  });

  it('explains package changes and lists the remaining lockfile changes', () => {
    const app = diffReports(head, base).apps[0];
    expect(app?.packages.map((p) => [p.name, p.cause?.kind])).toEqual([
      ['moment', 'added'],
      ['react-dom', 'upgraded'],
      ['clsx', 'added'],
    ]);
    expect(app?.packages[0]?.alternatives?.replacements).toContain('day.js');
    expect(app?.dependencies.map((d) => [d.name, d.kind])).toEqual([['vite', 'upgraded']]);
  });

  it('says when a package changed without a version change', () => {
    const imported = modify(base, (r) => {
      const main = r.apps[0]?.assets?.[0];
      if (main)
        main.packages = [
          { name: 'react-dom', bytes: 70_000 },
          { name: 'react', bytes: 5_000 },
        ];
    });
    expect(diffReports(imported, base).apps[0]?.packages[0]?.cause).toEqual({
      kind: 'no-version-change',
    });
  });

  it('gives no cause without dependency snapshots on both sides', () => {
    const bare = modify(head, (r) => {
      delete (r.apps[0] as App).dependencies;
    });
    expect(diffReports(bare, base).apps[0]?.packages.every((p) => p.cause === undefined)).toBe(
      true,
    );
  });

  it('caps the list of unexplained lockfile changes', () => {
    const many = modify(base, (r) => {
      const app = r.apps[0] as App;
      app.dependencies = Array.from({ length: 60 }, (_, i) => ({
        name: `dep-${i}`,
        version: '1.0.0',
        direct: true,
      }));
    });
    const app = diffReports(many, base).apps[0];
    expect(app?.dependencies).toHaveLength(50);
    expect(app?.omitted.dependencies).toBe(13); // 60 added + 3 removed
    expect(renderMarkdown(diffReports(many, base))).toContain(
      '63 lockfile changes without a bundle size change',
    );
  });

  it('renders the Why column, alternatives and lockfile-only changes', async () => {
    await expect(renderMarkdown(diffReports(head, base), { marker: false })).toMatchFileSnapshot(
      './__snapshots__/attribution.md',
    );
  });
});
