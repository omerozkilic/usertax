import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFramework, readPackageJson } from '@usertax/measure';

describe('detectFramework', () => {
  it.each([
    [{ dependencies: { next: '16' } }, 'next'],
    [{ dependencies: { expo: '58', 'react-native': '0.88' } }, 'expo'],
    [{ dependencies: { 'react-native': '0.88' } }, 'react-native'],
    [{ devDependencies: { vite: '8' } }, 'vite'],
    [{ devDependencies: { webpack: '5' } }, 'webpack'],
    [{}, 'static'],
    [undefined, 'static'],
  ] as const)('%j → %s', (pkg, framework) => {
    expect(detectFramework(pkg)).toBe(framework);
  });
});

describe('readPackageJson', () => {
  it('reads package.json or returns undefined when missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-detect-'));
    expect(await readPackageJson(dir)).toBeUndefined();
    await writeFile(join(dir, 'package.json'), '{"name":"x"}');
    expect(await readPackageJson(dir)).toEqual({ name: 'x' });
  });

  it('rethrows other errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-detect-'));
    await writeFile(join(dir, 'package.json'), '{');
    await expect(readPackageJson(dir)).rejects.toThrow(SyntaxError);
  });
});
