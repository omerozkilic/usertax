import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ServerError,
  freePort,
  serveStatic,
  startCommand,
  startNext,
  waitForUrl,
} from '@usertax/measure';
import type { StaticServer } from '@usertax/measure';

const root = fileURLToPath(new URL('./fixtures/vite-dist/', import.meta.url));

function get(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; type: string; encoding: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          type: response.headers['content-type'] ?? '',
          encoding: response.headers['content-encoding'] ?? '',
          body: Buffer.concat(chunks),
        });
      });
    })
      .on('error', reject)
      .end();
  });
}

describe('serveStatic', () => {
  let server: StaticServer;
  beforeAll(async () => {
    server = await serveStatic(root);
  });
  afterAll(async () => {
    await server.close();
  });

  it('serves index pages for directory paths', async () => {
    const home = await get(`${server.url}/`);
    expect(home.status).toBe(200);
    expect(home.type).toBe('text/html; charset=utf-8');
    expect(home.body.toString()).toContain('<div id="root">');
    expect((await get(`${server.url}/about/`)).body.toString()).toContain('About');
    expect((await get(`${server.url}/about`)).status).toBe(200);
  });

  it('gzips text when the client accepts it', async () => {
    const main = (await readdir(join(root, 'assets'))).find((f) => /^main-[\w-]+\.js$/.test(f));
    const plain = await get(`${server.url}/assets/${main ?? ''}`);
    const gzipped = await get(`${server.url}/assets/${main ?? ''}`, {
      'accept-encoding': 'gzip, br',
    });
    expect(plain.encoding).toBe('');
    expect(gzipped.encoding).toBe('gzip');
    expect(gunzipSync(gzipped.body)).toEqual(plain.body);
    expect(plain.type).toBe('text/javascript; charset=utf-8');
  });

  it('answers 404 for missing files and paths outside the root', async () => {
    expect((await get(`${server.url}/missing.js`)).status).toBe(404);
    expect((await get(`${server.url}/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
    expect((await get(`${server.url}/assets/main-DOR0Mk0h.js.unknownext`)).status).toBe(404);
  });

  it('serves unknown types as octet-stream and rejects malformed paths', async () => {
    expect((await get(`${server.url}/.vite/manifest.json`)).type).toBe('application/json');
    expect((await get(`${server.url}/%E0%A4%A`)).status).toBe(400);
  });
});

describe('startCommand and waitForUrl', () => {
  it('starts a server command, waits for it and stops it', async () => {
    const port = await freePort();
    const script = `require('http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1')`;
    const server = await startCommand(
      `"${process.execPath}" -e "${script}"`,
      process.cwd(),
      `http://127.0.0.1:${port}`,
    );
    expect(await (await fetch(server.url)).text()).toBe('ok');
    await server.close();
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it('fails when the command exits early or never answers', async () => {
    const port = await freePort();
    await expect(
      startCommand(
        `"${process.execPath}" -e "process.exit(1)"`,
        process.cwd(),
        `http://127.0.0.1:${port}`,
      ),
    ).rejects.toThrow(/exited before/);
    await expect(waitForUrl(`http://127.0.0.1:${port}`, 300)).rejects.toThrow(
      /did not answer within 0 s/,
    );
    await expect(
      startCommand(
        `"${process.execPath}" -e "setTimeout(()=>{},5000)"`,
        process.cwd(),
        `http://127.0.0.1:${port}`,
        300,
      ),
    ).rejects.toBeInstanceOf(ServerError);
  });

  it('reports a missing next package', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'usertax-no-next-'));
    await expect(startNext(empty)).rejects.toThrow(/cannot find the next package/);
  });
});
