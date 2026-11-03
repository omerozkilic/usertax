import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP, main } from 'usertax';

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

  it('reports commands that are not implemented yet', async () => {
    const c = capture();
    expect(await main(['measure'], c.io)).toBe(2);
    expect(c.err()).toContain('not implemented');
  });

  it('rejects unknown commands', async () => {
    const c = capture();
    expect(await main(['deploy'], c.io)).toBe(2);
    expect(c.err()).toContain('Unknown command: deploy');
  });

  it('rejects unknown options', async () => {
    const c = capture();
    expect(await main(['--nope'], c.io)).toBe(2);
    expect(c.err()).toContain('--nope');
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
