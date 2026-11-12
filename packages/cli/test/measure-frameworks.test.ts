import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReport } from '@usertax/core';
import { main } from '@usertax/cli';

const fixtures = new URL('../../measure/test/fixtures/', import.meta.url);

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/** An app directory with a package.json and one copy of a real build output. */
async function app(dependencies: Record<string, string>, output: string, fixture: string) {
  const dir = await mkdtemp(join(tmpdir(), 'usertax-framework-'));
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', devDependencies: dependencies }),
  );
  await mkdir(join(dir, output), { recursive: true });
  await cp(new URL(fixture, fixtures), join(dir, output), { recursive: true });
  return dir;
}

async function measure(args: string[]) {
  const c = capture();
  const code = await main(['measure', ...args], c.io);
  expect(code, c.err()).toBe(0);
  return parseReport(JSON.parse(c.out())).apps[0];
}

describe('usertax measure for Vite-based frameworks', () => {
  it('measures an Astro app from dist, with a route per page', async () => {
    const dir = await app({ astro: '7', vite: '8' }, 'dist', 'astro-dist/');
    const measured = await measure([dir]);
    expect(measured?.framework).toBe('astro');
    expect(measured?.routes?.map((r) => r.route)).toEqual(['/', '/about/']);
  });

  it('measures a SvelteKit app from the adapter-static output in build', async () => {
    const dir = await app({ '@sveltejs/kit': '3', vite: '8' }, 'build', 'sveltekit-dist/');
    const measured = await measure([dir]);
    expect(measured?.framework).toBe('sveltekit');
    expect(measured?.routes?.map((r) => r.route)).toEqual(['/', '/about']);
  });

  it('falls back to the client output of SvelteKit when there is no build directory', async () => {
    const dir = await app(
      { '@sveltejs/kit': '3', vite: '8' },
      '.svelte-kit/output/client',
      'sveltekit-dist/',
    );
    // The client output has the assets only; the prerendered pages are written elsewhere.
    for (const page of ['index.html', 'about.html']) {
      await rm(join(dir, '.svelte-kit/output/client', page));
    }
    const measured = await measure([dir]);
    expect(measured?.framework).toBe('sveltekit');
    expect(measured?.assets?.some((a) => a.type === 'js')).toBe(true);
    // The prerendered pages live next to the client output, not in it.
    expect(measured?.routes).toBeUndefined();
  });

  it('prefers an explicit --out-dir over the fallback', async () => {
    const dir = await app({ '@sveltejs/kit': '3' }, 'custom', 'sveltekit-dist/');
    const measured = await measure([dir, '--out-dir', 'custom']);
    expect(measured?.routes).toHaveLength(2);
  });

  it('accepts the framework by name', async () => {
    const dir = await app({}, 'dist', 'astro-dist/');
    expect((await measure([dir, '--framework', 'astro']))?.framework).toBe('astro');
  });

  it('says where a SvelteKit app is missing its output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usertax-framework-'));
    await writeFile(join(dir, 'package.json'), '{"devDependencies":{"@sveltejs/kit":"3"}}');
    const c = capture();
    expect(await main(['measure', dir], c.io)).toBe(2);
    expect(c.err()).toContain('build output');
    expect(c.err()).toContain(join(dir, 'build'));
  });
});
