import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { createGzip } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript)|image\/svg)/;

export interface StaticServer {
  readonly url: string;
  close(): Promise<void>;
}

async function resolveFile(root: string, pathname: string): Promise<string | undefined> {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative.split(sep).includes('..')) return undefined;
  const base = join(root, relative);
  const candidates = decoded.endsWith('/')
    ? [join(base, 'index.html')]
    : [base, `${base}.html`, join(base, 'index.html')];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => undefined);
    if (info?.isFile() === true) return candidate;
  }
  return undefined;
}

/**
 * Serves a build output directory on localhost for Lighthouse: `/about/` → `about/index.html`,
 * `/about` → `about.html` or `about/index.html`, gzip for text (as static hosts do), 404 otherwise.
 */
export function serveStatic(root: string): Promise<StaticServer> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    resolveFile(root, pathname)
      .then((file) => {
        if (file === undefined) {
          response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
          return;
        }
        const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
        const gzip =
          COMPRESSIBLE.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
        response.writeHead(200, {
          'content-type': type,
          'cache-control': 'no-cache',
          ...(gzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
        });
        const stream = createReadStream(file);
        (gzip ? stream.pipe(createGzip()) : stream).pipe(response);
      })
      .catch(() => {
        response.writeHead(400).end();
      });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) =>
            server.close(() => {
              done();
            }),
          ),
      });
    });
  });
}
