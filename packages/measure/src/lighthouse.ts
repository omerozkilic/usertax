import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Lighthouse, LighthouseRun } from '@usertax/core';

export class LighthouseError extends Error {
  override readonly name = 'LighthouseError';
}

/** The parts of a Lighthouse result (LHR) usertax reads. */
export interface LighthouseResultLike {
  readonly lighthouseVersion: string;
  readonly runtimeError?: { readonly code?: string; readonly message?: string };
  readonly categories: { readonly performance?: { readonly score: number | null } };
  readonly audits: Record<string, { readonly numericValue?: number } | undefined>;
}

/** Extracts one usertax run from a Lighthouse result. Throws when the run failed. */
export function runFromResult(lhr: LighthouseResultLike): LighthouseRun {
  if (lhr.runtimeError !== undefined) {
    throw new LighthouseError(
      `Lighthouse failed: ${lhr.runtimeError.code ?? ''} ${lhr.runtimeError.message ?? ''}`.trim(),
    );
  }
  const score = lhr.categories.performance?.score;
  const value = (id: string) => {
    const audit = lhr.audits[id]?.numericValue;
    if (audit === undefined || !Number.isFinite(audit))
      throw new LighthouseError(`Lighthouse result has no ${id}`);
    return audit;
  };
  if (score === undefined || score === null)
    throw new LighthouseError('Lighthouse result has no performance score');
  return {
    performance: Math.round(score * 100 * 10) / 10,
    lcp: value('largest-contentful-paint'),
    tbt: value('total-blocking-time'),
    cls: value('cumulative-layout-shift'),
  };
}

export interface RunLighthouseOptions {
  /** Absolute URLs to audit. Reports key them by path (`/pricing`). */
  readonly urls: readonly string[];
  /** Runs per URL. */
  readonly runs: number;
  /**
   * Runs per URL before the recorded ones, discarded (default 1). The first run after a server
   * starts is consistently slower (ADR 0007 calibration: Next.js TBT 167–191 ms against ~90 ms).
   */
  readonly warmup?: number;
  readonly formFactor?: 'mobile' | 'desktop';
  /** Chrome executable; defaults to chrome-launcher's detection (`CHROME_PATH` is honoured). */
  readonly chromePath?: string;
  /** Called after every run, for progress output. */
  readonly onRun?: (url: string, run: number, result: LighthouseRun) => void;
}

interface LighthouseModule {
  default: (
    url: string,
    flags: Record<string, unknown>,
    config?: unknown,
  ) => Promise<{ lhr: LighthouseResultLike } | undefined>;
}
interface ChromeLauncherModule {
  launch: (
    options: Record<string, unknown>,
  ) => Promise<{ port: number; kill: () => Promise<void> | void }>;
}

async function load<T>(name: string): Promise<T> {
  try {
    return (await import(name)) as T;
  } catch {
    // The GitHub Action runs from its own directory; look in the project being measured too.
  }
  try {
    const resolved = createRequire(join(process.cwd(), 'package.json')).resolve(name);
    return (await import(pathToFileURL(resolved).href)) as T;
  } catch {
    throw new LighthouseError(
      `"${name}" is not installed. Lighthouse support needs the optional packages lighthouse and chrome-launcher: npm install -D lighthouse chrome-launcher`,
    );
  }
}

/** Path and query of a URL: how reports identify a page. */
export function pageKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Runs Lighthouse (performance only) `runs` times per URL, alternating URLs, with a fresh Chrome
 * for every run so runs do not share caches.
 */
export async function runLighthouse(options: RunLighthouseOptions): Promise<Lighthouse[]> {
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) {
    throw new LighthouseError('runs must be an integer between 1 and 100');
  }
  const warmup = options.warmup ?? 1;
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 10) {
    throw new LighthouseError('warmup must be an integer between 0 and 10');
  }
  const { default: lighthouse } = await load<LighthouseModule>('lighthouse');
  const launcher = await load<ChromeLauncherModule>('chrome-launcher');
  const formFactor = options.formFactor ?? 'mobile';
  const config =
    formFactor === 'desktop'
      ? (await load<{ default: unknown }>('lighthouse/core/config/desktop-config.js')).default
      : undefined;
  const flags = ['--headless=new', '--disable-gpu', '--no-first-run'];
  // Chrome refuses to start its sandbox as root (containers); GitHub-hosted runners are not root.
  if (process.getuid?.() === 0) flags.push('--no-sandbox');

  const results = new Map<string, { version: string; runs: LighthouseRun[] }>();
  // Runs 0 and below are warm-up runs: audited like the others, not recorded.
  for (let run = 1 - warmup; run <= options.runs; run += 1) {
    for (const url of options.urls) {
      const chrome = await launcher.launch({
        chromeFlags: flags,
        ...(options.chromePath === undefined ? {} : { chromePath: options.chromePath }),
      });
      try {
        const result = await lighthouse(
          url,
          { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] },
          config,
        );
        if (result === undefined)
          throw new LighthouseError(`Lighthouse returned no result for ${url}`);
        const measured = runFromResult(result.lhr);
        if (run < 1) continue;
        const entry = results.get(url) ?? { version: result.lhr.lighthouseVersion, runs: [] };
        entry.runs.push(measured);
        results.set(url, entry);
        options.onRun?.(url, run, measured);
      } finally {
        await chrome.kill();
      }
    }
  }
  return options.urls.map((url) => {
    const entry = results.get(url) as { version: string; runs: LighthouseRun[] };
    return { url: pageKey(url), formFactor, lighthouseVersion: entry.version, runs: entry.runs };
  });
}
