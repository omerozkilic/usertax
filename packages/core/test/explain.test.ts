import { describe, expect, it } from 'vitest';
import { explainPackage } from '@usertax/core';
import { mobileApp, modify, report, webApp } from './fixtures.js';

describe('explainPackage', () => {
  const base = report([webApp(), mobileApp()]);
  const head = modify(base, (r) => {
    const [web, mobile] = r.apps;
    const about = web?.assets?.[1];
    if (about) about.packages = [{ name: 'moment', bytes: 60_000 }];
    const bundle = mobile?.bundles?.[0];
    if (bundle) bundle.packages = [...(bundle.packages ?? []), { name: 'moment', bytes: 58_000 }];
    if (web)
      web.dependencies = [
        { name: 'moment', version: '2.30.1', direct: true },
        { name: 'react-dom', version: '19.3.1', direct: true },
      ];
    if (mobile)
      mobile.dependencies = [{ name: 'moment', version: '2.29.4', direct: false, via: ['x'] }];
  });

  it('lists the files, lockfile entries and alternatives of a package', () => {
    const result = explainPackage('moment', head, base);
    expect(result.head).toEqual([
      {
        appId: 'web',
        appName: 'web',
        files: [{ key: 'assets/about-[hash].js', file: 'assets/about-9f8e7d.js', bytes: 60_000 }],
        bytes: 60_000,
        dependencies: [{ name: 'moment', version: '2.30.1', direct: true }],
      },
      {
        appId: 'mobile',
        appName: 'mobile',
        files: [
          { key: 'bundle[android]', file: 'dist/_expo/static/js/android/index.hbc', bytes: 58_000 },
        ],
        bytes: 58_000,
        dependencies: [{ name: 'moment', version: '2.29.4', direct: false, via: ['x'] }],
      },
    ]);
    expect(result.base).toEqual([]);
    expect(result.alternatives?.replacements).toContain('day.js');
  });

  it('sorts files by size and leaves out the base and alternatives when absent', () => {
    const twice = modify(head, (r) => {
      const index = r.apps[0]?.assets?.[0];
      if (index) index.packages = [{ name: 'moment', bytes: 1_000 }];
    });
    const result = explainPackage('moment', twice);
    expect(result.head[0]?.files.map((f) => f.bytes)).toEqual([60_000, 1_000]);
    expect(result).not.toHaveProperty('base');
    expect(explainPackage('react', head)).not.toHaveProperty('alternatives');
    expect(explainPackage('react', head).head.map((a) => a.appId)).toEqual(['web']);
  });
});
