import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELP, main } from '@usertax/cli';
import { BASE_SHA, modify, report, webApp } from '../../core/test/fixtures.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('usertax CLI', () => {
  it('prints help without arguments', async () => {
    const c = capture();
    expect(await main([], c.io)).toBe(0);
    expect(c.out()).toBe(HELP);
  });

  it('prints help with --help', async () => {
    const c = capture();
    expect(await main(['--help'], c.io)).toBe(0);
    expect(c.out()).toContain('Usage:');
  });

  it('prints the package version', async () => {
    const c = capture();
    expect(await main(['-v'], c.io)).toBe(0);
    expect(c.out()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('rejects unknown commands', async () => {
    const c = capture();
    expect(await main(['deploy'], c.io)).toBe(2);
    expect(c.err()).toContain('unknown command "deploy"');
  });

  it('rejects unknown options', async () => {
    const c = capture();
    expect(await main(['--nope'], c.io)).toBe(2);
    expect(c.err()).toContain('--nope');
  });
});

describe('usertax diff', () => {
  let dir: string;
  let basePath: string;
  let headPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'usertax-cli-'));
    const base = report([webApp()], { git: { sha: BASE_SHA } });
    const head = modify(base, (r) => {
      const asset = r.apps[0]?.assets?.[0];
      if (asset) asset.gzip = 40_000;
    });
    basePath = join(dir, 'base.json');
    headPath = join(dir, 'head.json');
    await writeFile(basePath, JSON.stringify(base));
    await writeFile(headPath, JSON.stringify(head));
  });

  it('prints a Markdown comparison', async () => {
    const c = capture();
    expect(await main(['diff', headPath, '--base', basePath], c.io)).toBe(0);
    expect(c.out()).toContain('| 🔴 | JS total (gzip) | 34.0 kB | 44.0 kB | +10.0 kB (+29.4%) |');
    expect(c.out()).not.toContain('<!-- usertax:report -->');
  });

  it('lists head values without a base', async () => {
    const c = capture();
    expect(await main(['diff', headPath], c.io)).toBe(0);
    expect(c.out()).toContain('no base report to compare with');
  });

  it('writes JSON to a file', async () => {
    const c = capture();
    const output = join(dir, 'diff.json');
    expect(
      await main(
        [
          'diff',
          headPath,
          '-b',
          basePath,
          '-f',
          'json',
          '-c',
          'brotli',
          '--top',
          '3',
          '-o',
          output,
        ],
        c.io,
      ),
    ).toBe(0);
    expect(c.out()).toBe('');
    const json = JSON.parse(await readFile(output, 'utf8')) as { diff: { apps: unknown[] } };
    expect(json.diff.apps).toHaveLength(1);
  });

  it('prints its own help', async () => {
    const c = capture();
    expect(await main(['diff', '--help'], c.io)).toBe(0);
    expect(c.out()).toContain('usertax diff <head-report.json>');
  });

  it.each([
    [[], 'missing <head-report.json>'],
    [['a.json', 'b.json'], 'unexpected arguments: b.json'],
    [['x', '-f', 'xml'], 'unknown format "xml"'],
    [['x', '-c', 'zstd'], 'unknown compression "zstd"'],
    [['x', '--top=-1'], '--top must be an integer'],
    [['x', '--top', 'many'], '--top must be an integer'],
    [['x', '--bogus'], "Unknown option '--bogus'"],
  ])('rejects invalid usage %j', async (args, expected) => {
    const c = capture();
    expect(await main(['diff', ...args], c.io)).toBe(2);
    expect(c.err()).toContain(expected);
    expect(c.err()).toContain('Run "usertax diff --help"');
  });

  it('rejects missing, malformed and invalid reports', async () => {
    const malformed = join(dir, 'malformed.json');
    const invalid = join(dir, 'invalid.json');
    await writeFile(malformed, '{');
    await writeFile(invalid, JSON.stringify({ schemaVersion: 1 }));
    for (const [path, expected] of [
      [join(dir, 'missing.json'), 'cannot read head report'],
      [malformed, 'is not valid JSON'],
      [invalid, 'invalid usertax report'],
    ] as const) {
      const c = capture();
      expect(await main(['diff', path], c.io)).toBe(2);
      expect(c.err()).toContain(expected);
    }
  });
});

describe('internal errors', () => {
  it('exits with code 3 when something unexpected fails', async () => {
    const err: string[] = [];
    const io = {
      stdout: () => {
        throw new Error('stdout closed');
      },
      stderr: (t: string) => err.push(t),
    };
    expect(await main(['--version'], io)).toBe(3);
    expect(err.join('')).toBe('usertax: internal error: stdout closed\n');
  });
});

describe('default io', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes to process.stdout and process.stderr', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await main(['--version'])).toBe(0);
    expect(await main(['deploy'])).toBe(2);
    expect(stdout).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledOnce();
  });
});
