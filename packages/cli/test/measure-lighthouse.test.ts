import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseReport } from '@usertax/core';

const audited: string[] = [];

vi.mock('chrome-launcher', () => ({
  launch: () => Promise.resolve({ port: 9222, kill: () => undefined }),
}));
vi.mock('lighthouse', async () => {
  const real = JSON.parse(
    await readFile(
      new URL('../../measure/test/fixtures/lighthouse-vite.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;
  return {
    default: async (url: string) => {
      audited.push(url);
      // The page must really be served: fetch it like Lighthouse would.
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return { lhr: real };
    },
  };
});

const { main } = await import('usertax');
const fixture = new URL('../../measure/test/fixtures/vite-dist/', import.meta.url);

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('usertax measure --lighthouse', () => {
  let app: string;
  beforeAll(async () => {
    app = await mkdtemp(join(tmpdir(), 'usertax-lh-'));
    await cp(fixture, join(app, 'dist'), { recursive: true });
    await writeFile(join(app, 'package.json'), '{"devDependencies":{"vite":"8"}}');
  });

  it('serves the build output and records every run', async () => {
    audited.length = 0;
    const c = capture();
    const code = await main(
      [
        'measure',
        app,
        '--sha',
        'a'.repeat(40),
        '--lighthouse',
        '/',
        '--lighthouse',
        '/about/',
        '--runs',
        '2',
      ],
      c.io,
    );
    expect(code).toBe(0);
    // One warm-up run per page (not recorded), then two recorded runs.
    expect(audited.map((url) => new URL(url).pathname)).toEqual([
      '/',
      '/about/',
      '/',
      '/about/',
      '/',
      '/about/',
    ]);
    expect(c.err()).toContain(
      'lighthouse / run 2/2: performance 100, LCP 756 ms, TBT 0 ms, CLS 0.000',
    );
    const lighthouse = parseReport(JSON.parse(c.out())).apps[0]?.lighthouse;
    expect(lighthouse?.map((l) => [l.url, l.formFactor, l.runs.length])).toEqual([
      ['/', 'mobile', 2],
      ['/about/', 'mobile', 2],
    ]);
  });

  it('audits an already running server', async () => {
    const { serveStatic } = await import('@usertax/measure');
    const server = await serveStatic(join(app, 'dist'));
    audited.length = 0;
    const c = capture();
    expect(
      await main(
        [
          'measure',
          app,
          '--sha',
          'a'.repeat(40),
          '--lighthouse',
          '/',
          '--runs',
          '1',
          '--warmup',
          '0',
          '--base-url',
          `${server.url}/`,
        ],
        c.io,
      ),
    ).toBe(0);
    expect(audited).toEqual([`${server.url}/`]);
    await server.close();
  });

  it('starts a server command', async () => {
    const { freePort } = await import('@usertax/measure');
    const port = await freePort();
    const script = `require('http').createServer((q,s)=>s.end('<html></html>')).listen(${port},'127.0.0.1')`;
    const c = capture();
    const args = [
      'measure',
      app,
      '--sha',
      'a'.repeat(40),
      '--lighthouse',
      '/',
      '--runs',
      '1',
      '--start',
      `"${process.execPath}" -e "${script}"`,
      '--base-url',
      `http://127.0.0.1:${port}`,
    ];
    expect(await main(args, c.io)).toBe(0);
    expect(parseReport(JSON.parse(c.out())).apps[0]?.lighthouse?.[0]?.runs).toHaveLength(1);
  });

  it.each([
    [['--runs', '0'], '--runs must be an integer between 1 and 100'],
    [['--warmup', '11'], '--warmup must be an integer between 0 and 10'],
    [['--form-factor', 'tablet'], '--form-factor must be mobile or desktop'],
    [['--start', 'pnpm start'], '--start needs --base-url'],
  ])('rejects %j', async (args, expected) => {
    const c = capture();
    expect(await main(['measure', app, '--lighthouse', '/', ...args], c.io)).toBe(2);
    expect(c.err()).toContain(expected);
  });

  it('rejects pages that are not paths', async () => {
    const c = capture();
    expect(await main(['measure', app, '--lighthouse', 'https://example.com/'], c.io)).toBe(2);
    expect(c.err()).toContain('--lighthouse expects a path starting with /');
  });

  it('reports a server that never answers as a usage error', async () => {
    const c = capture();
    const args = [
      'measure',
      app,
      '--lighthouse',
      '/',
      '--start',
      `"${process.execPath}" -e "process.exit(0)"`,
      '--base-url',
      'http://127.0.0.1:9',
    ];
    expect(await main(args, c.io)).toBe(2);
    expect(c.err()).toContain('exited before');
  });
});
