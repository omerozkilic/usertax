import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extensionContamination, runFromResult } from '@usertax/measure';
import type { LighthouseResultLike } from '@usertax/measure';

async function fixture(name: string): Promise<LighthouseResultLike> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  ) as LighthouseResultLike;
}

const base: LighthouseResultLike = {
  lighthouseVersion: '13.6.0',
  categories: { performance: { score: 1 } },
  audits: {},
};

function withUrls(...urls: unknown[]): LighthouseResultLike {
  return {
    ...base,
    audits: { 'network-requests': { details: { items: urls.map((url) => ({ url })) } } },
  };
}

describe('a run with a browser extension active', () => {
  it('is recorded from a real Lighthouse result', async () => {
    const run = runFromResult(await fixture('lighthouse-extension.json'));
    expect(run).toMatchObject({
      performance: 100,
      lcp: 627.50935,
      tbt: 0,
      cls: 0,
      contamination: {
        origins: ['chrome-extension://nojlinpnfpblhnlcjpgaeankkhjbnean'],
        requestCount: 1,
      },
    });
  });

  it('leaves a clean run without the field', async () => {
    expect(runFromResult(await fixture('lighthouse-vite.json'))).not.toHaveProperty(
      'contamination',
    );
  });
});

describe('extensionContamination', () => {
  it('finds extension schemes and counts each URL once', () => {
    expect(
      extensionContamination(
        withUrls(
          'chrome-extension://aaa/content.js',
          'chrome-extension://aaa/content.js',
          'chrome-extension://aaa/other.js',
          'moz-extension://bbb/x.js',
          'safari-web-extension://ccc/y.js',
        ),
      ),
    ).toEqual({
      origins: ['chrome-extension://aaa', 'moz-extension://bbb', 'safari-web-extension://ccc'],
      requestCount: 4,
    });
  });

  it('reads the scripts that other audits list, not only requests', () => {
    const lhr: LighthouseResultLike = {
      ...base,
      audits: {
        'unused-javascript': { details: { items: [{ url: 'chrome-extension://aaa/inpage.js' }] } },
        'bootup-time': { details: { items: [{ url: 'chrome-extension://bbb/content.js' }] } },
      },
    };
    expect(extensionContamination(lhr)?.origins).toEqual([
      'chrome-extension://aaa',
      'chrome-extension://bbb',
    ]);
  });

  it('ignores web pages, data and blob URLs, other schemes and non-strings', () => {
    expect(
      extensionContamination(
        withUrls(
          'https://example.com/chrome-extension://x',
          'http://127.0.0.1:3000/',
          'data:text/plain,hi',
          'blob:https://example.com/1',
          'chrome://version',
          'about:blank',
          undefined,
          42,
          { url: 'chrome-extension://nested/' },
        ),
      ),
    ).toBeUndefined();
  });

  it('keeps at most 20 origins and bounded text', () => {
    const urls = Array.from({ length: 30 }, (_, i) => `chrome-extension://ext${i}/x.js`);
    expect(extensionContamination(withUrls(...urls))?.origins).toHaveLength(20);
    const long = extensionContamination(withUrls(`chrome-extension://${'a'.repeat(500)}/x.js`));
    expect(long?.origins[0]?.length).toBeLessThanOrEqual(130);
  });

  it('stays fast and bounded on a hostile URL', () => {
    const url = `chrome-extension://${'-'.repeat(200_000)}\n`;
    const started = performance.now();
    const found = extensionContamination(withUrls(url));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(found?.origins[0]?.length).toBeLessThanOrEqual(130);
  });

  it('stays fast on a hostile scheme', () => {
    const started = performance.now();
    expect(extensionContamination(withUrls(`a${'-'.repeat(400_000)}\n`))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
