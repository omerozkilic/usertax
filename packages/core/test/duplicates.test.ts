import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';
import { diffReports, renderMarkdown } from '@usertax/core';
import type { App, Report } from '@usertax/core';
import { BASE_SHA, modify, report, webApp } from './fixtures.js';

const LODASH = {
  name: 'lodash',
  bytes: 30_000,
  versions: [
    { version: '4.17.21', bytes: 16_000 },
    { version: '4.17.20', bytes: 14_000 },
  ],
};

/** The web fixture with `lodash` bundled in two versions, and the dependency snapshot behind it. */
function withDuplicate(source: Report): Report {
  return modify(source, (r) => {
    const web = r.apps[0] as App;
    const main = web.assets?.[0];
    if (main) main.packages = [...(main.packages ?? []), LODASH];
    web.dependencies = [
      { name: 'lodash', version: '4.17.21', direct: true },
      { name: 'lodash', version: '4.17.20', direct: false, via: ['some-lib'] },
    ];
  });
}

const base = report([webApp()], { git: { sha: BASE_SHA } });
const head = withDuplicate(base);

describe('duplicate packages', () => {
  it('lists the versions a bundle contains with their bytes and who pulls them in', () => {
    const [duplicate] = diffReports(head, base).apps[0]?.duplicates ?? [];
    expect(duplicate).toEqual({
      scope: 'web',
      name: 'lodash',
      bytes: 30_000,
      introduced: true,
      versions: [
        { version: '4.17.21', bytes: 16_000, direct: true },
        { version: '4.17.20', bytes: 14_000, direct: false, via: ['some-lib'] },
      ],
    });
  });

  it('adds up the same version across several files', () => {
    const split = modify(head, (r) => {
      const web = r.apps[0] as App;
      web.assets = [
        ...(web.assets ?? []),
        {
          key: 'assets/chunk-[hash].js',
          file: 'assets/chunk-77.js',
          type: 'js',
          raw: 9_000,
          gzip: 3_000,
          brotli: 2_500,
          packages: [
            {
              name: 'lodash',
              bytes: 9_000,
              versions: [
                { version: '4.17.20', bytes: 4_000 },
                { version: '4.17.21', bytes: 5_000 },
              ],
            },
          ],
        },
      ];
    });
    const [duplicate] = diffReports(split, base).apps[0]?.duplicates ?? [];
    expect(duplicate?.versions.map((v) => [v.version, v.bytes])).toEqual([
      ['4.17.21', 21_000],
      ['4.17.20', 18_000],
    ]);
    expect(duplicate?.bytes).toBe(39_000);
  });

  it('marks a duplicate as existing when the base already had it', () => {
    const [duplicate] = diffReports(head, head).apps[0]?.duplicates ?? [];
    expect(duplicate?.introduced).toBe(false);
  });

  it('does not say whether a duplicate is new without a base report', () => {
    const [duplicate] = diffReports(head).apps[0]?.duplicates ?? [];
    expect(duplicate?.name).toBe('lodash');
    expect(duplicate).not.toHaveProperty('introduced');
  });

  it('ignores a package that is in one version only, or has no version split', () => {
    expect(diffReports(base, base).apps[0]?.duplicates).toEqual([]);
  });

  it('lists new duplicates first and caps the list', () => {
    const many = modify(withDuplicate(base), (r) => {
      const main = (r.apps[0] as App).assets?.[0];
      main?.packages?.push(
        {
          name: 'aaa',
          bytes: 100,
          versions: [
            { version: '1.0.0', bytes: 60 },
            { version: '2.0.0', bytes: 40 },
          ],
        },
        {
          name: 'zzz',
          bytes: 90_000,
          versions: [
            { version: '1.0.0', bytes: 50_000 },
            { version: '2.0.0', bytes: 40_000 },
          ],
        },
      );
    });
    // `zzz` is the largest, but already existed in the base; `lodash` and `aaa` are new.
    const baseWithZzz = modify(base, (r) => {
      (r.apps[0] as App).assets?.[0]?.packages?.push({
        name: 'zzz',
        bytes: 90_000,
        versions: [
          { version: '1.0.0', bytes: 50_000 },
          { version: '2.0.0', bytes: 40_000 },
        ],
      });
    });
    const app = diffReports(many, baseWithZzz, { top: 2 }).apps[0];
    expect(app?.duplicates.map((d) => [d.name, d.introduced])).toEqual([
      ['lodash', true],
      ['aaa', true],
    ]);
    expect(app?.omitted.duplicates).toBe(1);
  });
});

describe('duplicate packages in the comment', () => {
  it('shows new duplicates in the open', async () => {
    await expect(renderMarkdown(diffReports(head, base), { marker: false })).toMatchFileSnapshot(
      './__snapshots__/duplicates.md',
    );
  });

  it('collapses duplicates that were already in the base', () => {
    const markdown = renderMarkdown(diffReports(head, head), { marker: false });
    expect(markdown).toContain('<summary>1 duplicate package already in the base</summary>');
    expect(markdown).not.toContain('**Duplicate packages**');
  });

  it('neutralises hostile package names and versions', () => {
    const hostile = modify(head, (r) => {
      const web = r.apps[0] as App;
      const lodash = web.assets?.[0]?.packages?.find((p) => p.name === 'lodash');
      if (lodash) {
        lodash.name = '`|<img src=x onerror=alert(1)>[x](https://evil.example)@everyone';
        lodash.versions = [
          { version: '1.0.0 <script>alert(1)</script>', bytes: 10 },
          { version: '2.0.0|`', bytes: 5 },
        ];
      }
      web.dependencies = [];
    });
    const markdown = renderMarkdown(diffReports(hostile, base));
    const html = micromark(markdown, {
      allowDangerousHtml: true,
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
    const tags = new Set([...html.matchAll(/<([a-z][a-z0-9]*)/g)].map((m) => m[1]));
    for (const tag of ['img', 'script', 'a']) expect(tags.has(tag)).toBe(false);
    // A mention only pings outside code spans; every hostile name stays inside one.
    expect(html.replace(/<code>[\s\S]*?<\/code>/g, '')).not.toContain('@everyone');
  });
});
