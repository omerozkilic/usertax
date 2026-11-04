import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LighthouseResultLike } from '@usertax/measure';

const launched: { port: number; kill: ReturnType<typeof vi.fn> }[] = [];
const calls: { url: string; config: unknown }[] = [];
let nextResult: (url: string) => { lhr: LighthouseResultLike } | undefined;

vi.mock('chrome-launcher', () => ({
  launch: vi.fn(() => {
    const chrome = { port: 9222 + launched.length, kill: vi.fn() };
    launched.push(chrome);
    return Promise.resolve(chrome);
  }),
}));
vi.mock('lighthouse', () => ({
  default: vi.fn((url: string, _flags: unknown, config: unknown) => {
    calls.push({ url, config });
    return Promise.resolve(nextResult(url));
  }),
}));
vi.mock('lighthouse/core/config/desktop-config.js', () => ({
  default: { extends: 'lighthouse:default', preset: 'desktop' },
}));

const { LighthouseError, pageKey, runFromResult, runLighthouse } = await import('@usertax/measure');

const real = JSON.parse(
  await readFile(new URL('./fixtures/lighthouse-vite.json', import.meta.url), 'utf8'),
) as LighthouseResultLike;

describe('runFromResult', () => {
  it('reads a real Lighthouse result', () => {
    expect(runFromResult(real)).toEqual({ performance: 100, lcp: 756.144, tbt: 0, cls: 0 });
  });

  it('rejects failed or incomplete results', () => {
    expect(() =>
      runFromResult({ ...real, runtimeError: { code: 'NO_FCP', message: 'no paint' } }),
    ).toThrow('Lighthouse failed: NO_FCP no paint');
    expect(() => runFromResult({ ...real, categories: { performance: { score: null } } })).toThrow(
      /no performance score/,
    );
    expect(() => runFromResult({ ...real, audits: {} })).toThrow(/no largest-contentful-paint/);
  });
});

describe('pageKey', () => {
  it('keeps path and query', () => {
    expect(pageKey('http://127.0.0.1:4000/pricing?plan=pro')).toBe('/pricing?plan=pro');
    expect(pageKey('http://127.0.0.1:4000')).toBe('/');
  });
});

describe('runLighthouse', () => {
  beforeEach(() => {
    launched.length = 0;
    calls.length = 0;
    let score = 0.9;
    nextResult = () => {
      score -= 0.01;
      return { lhr: { ...real, categories: { performance: { score } } } };
    };
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('alternates pages, uses a fresh Chrome per run and keeps every run', async () => {
    const progress: string[] = [];
    const result = await runLighthouse({
      urls: ['http://127.0.0.1:1/', 'http://127.0.0.1:1/about'],
      runs: 2,
      warmup: 0,
      onRun: (url, run) => progress.push(`${new URL(url).pathname}#${run}`),
    });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/', '/about', '/', '/about']);
    expect(launched).toHaveLength(4);
    expect(launched.every((chrome) => chrome.kill.mock.calls.length === 1)).toBe(true);
    expect(progress).toEqual(['/#1', '/about#1', '/#2', '/about#2']);
    expect(result).toEqual([
      {
        url: '/',
        formFactor: 'mobile',
        lighthouseVersion: '13.6.0',
        runs: [
          expect.objectContaining({ performance: 89 }),
          expect.objectContaining({ performance: 87 }),
        ],
      },
      {
        url: '/about',
        formFactor: 'mobile',
        lighthouseVersion: '13.6.0',
        runs: [
          expect.objectContaining({ performance: 88 }),
          expect.objectContaining({ performance: 86 }),
        ],
      },
    ]);
    expect(calls[0]?.config).toBeUndefined();
  });

  it('discards one warm-up run per page by default', async () => {
    const progress: string[] = [];
    const [entry] = await runLighthouse({
      urls: ['http://127.0.0.1:1/'],
      runs: 2,
      onRun: (url, run) => progress.push(`${new URL(url).pathname}#${run}`),
    });
    expect(calls).toHaveLength(3);
    expect(launched).toHaveLength(3);
    expect(progress).toEqual(['/#1', '/#2']);
    expect(entry?.runs).toHaveLength(2);
    await expect(runLighthouse({ urls: ['http://x/'], runs: 1, warmup: 11 })).rejects.toThrow(
      /warmup must be an integer/,
    );
  });

  it('uses the desktop configuration on request', async () => {
    const [entry] = await runLighthouse({
      urls: ['http://127.0.0.1:1/'],
      runs: 1,
      formFactor: 'desktop',
      chromePath: '/bin/chrome',
    });
    expect(entry?.formFactor).toBe('desktop');
    expect(calls[0]?.config).toEqual({ extends: 'lighthouse:default', preset: 'desktop' });
  });

  it('kills Chrome when a run fails', async () => {
    nextResult = () => undefined;
    await expect(runLighthouse({ urls: ['http://127.0.0.1:1/'], runs: 1 })).rejects.toThrow(
      /returned no result/,
    );
    expect(launched[0]?.kill).toHaveBeenCalledOnce();
  });

  it('validates the number of runs', async () => {
    await expect(runLighthouse({ urls: [], runs: 0 })).rejects.toBeInstanceOf(LighthouseError);
    await expect(runLighthouse({ urls: [], runs: 1.5 })).rejects.toThrow(/between 1 and 100/);
  });
});
