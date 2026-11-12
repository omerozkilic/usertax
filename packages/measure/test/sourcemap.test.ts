import { readFile, readdir } from 'node:fs/promises';
import { encode } from '@jridgewell/sourcemap-codec';
import { describe, expect, it } from 'vitest';
import {
  SourceMapError,
  attributeBytes,
  displayPath,
  isOutsideRepository,
  packageOf,
  parseSourceMap,
} from '@usertax/measure';
import type { RawSourceMap } from '@usertax/measure';

const fixture = new URL('./fixtures/vite-dist/assets/', import.meta.url);

function map(sources: string[], lines: number[][][]): RawSourceMap {
  return {
    version: 3,
    sources,
    mappings: encode(lines as unknown as Parameters<typeof encode>[0]),
  };
}

describe('packageOf', () => {
  it.each([
    ['node_modules/react/index.js', 'react'],
    ['node_modules/@scope/pkg/dist/x.js', '@scope/pkg'],
    [
      '../../node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/cjs/x.js',
      'react-dom',
    ],
    ['node_modules/a/node_modules/b/index.js', 'b'],
  ])('%s → %s', (path, expected) => {
    expect(packageOf(path)).toBe(expected);
  });

  it.each(['src/App.jsx', 'node_modules/', 'node_modules/@scope', 'node_modules/.pnpm/x'])(
    'returns undefined for %s',
    (path) => {
      expect(packageOf(path)).toBeUndefined();
    },
  );
});

describe('displayPath', () => {
  it('shortens dependency paths, including pnpm layouts', () => {
    expect(
      displayPath(
        '../../../../node_modules/.pnpm/react@19.3.1/node_modules/react/index.js',
        undefined,
        'dist/assets',
      ),
    ).toBe('node_modules/react/index.js');
  });

  it('resolves first-party sources relative to the app', () => {
    expect(displayPath('../../src/App.jsx', undefined, 'dist/assets')).toBe('src/App.jsx');
    expect(displayPath('App.jsx', '../../src/', 'dist/assets')).toBe('src/App.jsx');
    expect(displayPath('/abs/src/x.ts', undefined, 'dist')).toBe('/abs/src/x.ts');
  });

  it('handles virtual modules and URL schemes', () => {
    expect(displayPath('\0vite/preload-helper.js', undefined, 'dist')).toBe(
      '(virtual) vite/preload-helper.js',
    );
    expect(displayPath('webpack://my-app/./src/index.js?abc', undefined, '.')).toBe('src/index.js');
    expect(displayPath('webpack://my-app/node_modules/lodash/lodash.js', undefined, '.')).toBe(
      'node_modules/lodash/lodash.js',
    );
  });

  it('resolves webpack sources against the webpack context, not the map file', () => {
    const chunks = '.next/static/chunks/app/counter';
    expect(displayPath('webpack://_N_E/./app/counter/Counter.jsx', undefined, chunks)).toBe(
      'app/counter/Counter.jsx',
    );
    expect(displayPath('webpack://_N_E/../../src/client/index.tsx', undefined, chunks)).toBe(
      '../../src/client/index.tsx',
    );
    expect(
      displayPath(
        'webpack://_N_E/../../node_modules/.pnpm/next@16.4.4/node_modules/next/dist/x.js',
        undefined,
        chunks,
      ),
    ).toBe('node_modules/next/dist/x.js');
  });

  it('marks the webpack runtime, ignored and generated modules as virtual', () => {
    expect(displayPath('webpack://_N_E/webpack/runtime/load script', undefined, '.')).toBe(
      '(virtual) webpack/runtime/load script',
    );
    expect(displayPath('webpack://_N_E/webpack/bootstrap', undefined, '.')).toBe(
      '(virtual) webpack/bootstrap',
    );
    expect(displayPath('webpack://_N_E/', undefined, '.')).toBe('(virtual) webpack');
    expect(displayPath('webpack://_N_E/?f7bc', undefined, '.')).toBe('(virtual) webpack');
    expect(
      displayPath(
        'webpack://_N_E/ignored|/repo/node_modules/next/dist/loaders|stub',
        undefined,
        '.',
      ),
    ).toBe('(virtual) webpack/ignored');
  });
});

describe('isOutsideRepository', () => {
  it('detects paths that climb above the repository root', () => {
    expect(isOutsideRepository('../../../src/x.ts', 'examples/next-app')).toBe(true);
    expect(isOutsideRepository('../..', 'examples/next-app/web')).toBe(false);
    expect(isOutsideRepository('../../..', 'examples/next-app')).toBe(true);
    expect(isOutsideRepository('../../packages/ui/src/x.ts', 'examples/next-app')).toBe(false);
    expect(isOutsideRepository('../src/x.ts', '.')).toBe(true);
    expect(isOutsideRepository('src/x.ts', '.')).toBe(false);
    expect(isOutsideRepository('/abs/x.ts', '.')).toBe(false);
    expect(isOutsideRepository('(virtual) ../x', '.')).toBe(false);
  });
});

describe('parseSourceMap', () => {
  it('rejects invalid maps', () => {
    expect(() => parseSourceMap('{')).toThrow(SourceMapError);
    expect(() => parseSourceMap('null')).toThrow(/not an object/);
    expect(() => parseSourceMap('{"version":2,"sources":[],"mappings":""}')).toThrow(/version 3/);
    expect(() => parseSourceMap('{"version":3,"mappings":""}')).toThrow(/"sources"/);
  });

  it('flattens indexed maps (Metro) by shifting each section', () => {
    const flat = parseSourceMap(
      JSON.stringify({
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: { version: 3, sources: ['a.js'], mappings: 'AAAA' },
          },
          {
            offset: { line: 0, column: 4 },
            map: { version: 3, sourceRoot: 'lib/', sources: ['b.js', null], mappings: 'AAAA;ECAA' },
          },
        ],
      }),
    );
    expect(flat.sources).toEqual(['a.js', 'lib/b.js', null]);
    // line 0: a.js at 0, b.js at 4; line 1: column 2 from the second section's null source
    expect(attributeBytes('aaaabbbb\nxxyy', flat, '.').modules).toEqual([
      { path: 'a.js', bytes: 4 },
      { path: 'lib/b.js', bytes: 4 },
    ]);
  });

  it('rejects malformed indexed maps', () => {
    expect(() => parseSourceMap('{"version":3,"sections":{}}')).toThrow(/must be an array/);
    expect(() => parseSourceMap('{"version":3,"sections":[{"url":"x.map"}]}')).toThrow(
      /"url" sections/,
    );
    expect(() => parseSourceMap('{"version":3,"sections":[{"map":{}}]}')).toThrow(/section needs/);
  });

  it('keeps sourceRoot', () => {
    expect(
      parseSourceMap('{"version":3,"sources":["a"],"sourceRoot":"src/","mappings":""}'),
    ).toEqual({
      version: 3,
      sources: ['a'],
      sourceRoot: 'src/',
      mappings: '',
    });
  });
});

describe('attributeBytes', () => {
  it('assigns each segment the columns up to the next segment', () => {
    // "aaaabbb\ncc": source 0 covers 0-4, source 1 covers 4-7, line 2 from source 0
    const result = attributeBytes(
      'aaaabbb\ncc',
      map(
        ['node_modules/x/a.js', 'src/b.js'],
        [
          [
            [0, 0, 0, 0],
            [4, 1, 0, 0],
          ],
          [[0, 0, 1, 0]],
        ],
      ),
    );
    expect(Object.fromEntries(result.packages)).toEqual({ x: 6 });
    expect(result.firstPartyBytes).toBe(3);
    expect(result.unattributedBytes).toBe(1); // the newline
    expect(result.modules).toEqual([
      { path: 'node_modules/x/a.js', package: 'x', bytes: 6 },
      { path: 'src/b.js', bytes: 3 },
    ]);
  });

  it('counts foreign sources as unattributed and leaves them out of the modules', () => {
    const result = attributeBytes(
      'aaaabbb',
      map(
        ['../../src/next-internal.ts', 'src/b.js'],
        [
          [
            [0, 0, 0, 0],
            [4, 1, 0, 0],
          ],
        ],
      ),
      '.',
      (path) => path === '../../src/next-internal.ts',
    );
    expect(result.firstPartyBytes).toBe(3);
    expect(result.unattributedBytes).toBe(4);
    expect(result.modules).toEqual([{ path: 'src/b.js', bytes: 3 }]);
  });

  it('counts unmapped prefixes, source-less segments and null sources as unattributed', () => {
    const result = attributeBytes(
      '..aa..bb',
      map(['src/a.js', null as unknown as string], [[[2, 0, 0, 0], [4], [6, 1, 0, 0]]]),
    );
    expect(result.firstPartyBytes).toBe(2);
    expect(result.unattributedBytes).toBe(6);
  });

  it('counts UTF-8 bytes, not UTF-16 columns', () => {
    const result = attributeBytes('"ğü"', map(['src/t.js'], [[[0, 0, 0, 0]]]));
    expect(result.firstPartyBytes).toBe(6);
  });

  it('ignores segments beyond the end of a line', () => {
    const result = attributeBytes(
      'ab',
      map(
        ['src/a.js'],
        [
          [
            [0, 0, 0, 0],
            [10, 0, 0, 0],
          ],
        ],
      ),
    );
    expect(result.firstPartyBytes).toBe(2);
  });

  it('accounts for every byte of a real Vite chunk', async () => {
    // The vendor chunk; its hash changes when the fixture is rebuilt.
    const name = (await readdir(fixture)).find((file) => /^styles-[\w-]+\.js$/.test(file)) ?? '';
    const code = await readFile(new URL(name, fixture), 'utf8');
    const raw = parseSourceMap(await readFile(new URL(`${name}.map`, fixture), 'utf8'));
    const result = attributeBytes(code, raw, 'dist/assets');
    const packageBytes = [...result.packages.values()].reduce((a, b) => a + b, 0);
    expect(packageBytes + result.firstPartyBytes + result.unattributedBytes).toBe(
      Buffer.byteLength(code),
    );
    expect([...result.packages.keys()].sort()).toEqual(['react', 'react-dom', 'scheduler']);
    expect(result.modules[0]?.path).toBe(
      'node_modules/react-dom/cjs/react-dom-client.production.js',
    );
  });
});
