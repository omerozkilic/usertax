import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, configJsonSchema, parseConfig } from '@usertax/core';

describe('parseConfig', () => {
  it('applies defaults', () => {
    expect(parseConfig({})).toEqual({ budgets: [], compression: 'gzip', top: 10 });
  });

  it('parses apps, budgets and noise thresholds', () => {
    const config = parseConfig({
      $schema: './node_modules/@usertax/core/schema/config.schema.json',
      apps: [
        { path: 'apps/web', outDir: 'build', lighthouse: { pages: ['/'] } },
        {
          path: 'apps/mobile',
          framework: 'react-native',
          bundles: [{ platform: 'android', file: 'out/index.android.bundle' }],
          archives: [{ file: 'app.apk' }],
        },
      ],
      budgets: [{ metric: 'js.total.gzip', max: '200 kB' }],
      noise: { performance: { floor: 2, k: 1.5 } },
      compression: 'brotli',
      top: 5,
    });
    expect(config.apps?.[0]?.lighthouse).toEqual({
      pages: ['/'],
      runs: 5,
      warmup: 1,
      formFactor: 'mobile',
    });
    expect(config.budgets[0]).toMatchObject({ app: '*', level: 'fail' });
    expect(config.compression).toBe('brotli');
  });

  it('rejects unknown keys, so typos do not pass silently', () => {
    expect(() => parseConfig({ budget: [] })).toThrow(ConfigError);
    expect(() => parseConfig({ apps: [{ path: 'a', outdir: 'x' }] })).toThrow(/apps\.0/);
  });

  it('explains invalid values with their path', () => {
    expect(() =>
      parseConfig(
        { apps: [{ path: 'a', lighthouse: { pages: ['pricing'] } }] },
        'usertax.config.json',
      ),
    ).toThrow(/invalid usertax\.config\.json:\n- apps\.0\.lighthouse\.pages\.0/);
    expect(() =>
      parseConfig({
        apps: [{ path: 'a', lighthouse: { pages: ['/'], startCommand: 'pnpm start' } }],
      }),
    ).toThrow(/startCommand needs baseUrl/);
    expect(() => parseConfig(null)).toThrow(/\(root\)/);
  });
});

describe('configJsonSchema', () => {
  it('matches the committed schema file (run `pnpm --filter @usertax/core schema` to update)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../schema/config.schema.json', import.meta.url), 'utf8'),
    );
    expect(configJsonSchema()).toEqual(committed);
  });
});
