import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Asset, Route } from '@usertax/core';
import { scanOutputDir } from './web.js';
import type { MeasureResult, MeasureWebAppOptions } from './web.js';

const STATIC_PREFIX = '/_next/static/';
const SPECIAL = new Set([
  '_not-found',
  '_global-error',
  '404',
  '500',
  '_app',
  '_document',
  '_error',
]);

/** Turbopack and webpack chunk names that are only a hash, e.g. `3inebcps20pg4.js`. */
function isHashOnly(stem: string): boolean {
  return /^[0-9a-z_-]{8,}$/.test(stem) && /\d/.test(stem);
}

/**
 * Next.js chunk names carry no stable part, so a chunk is identified by its largest source
 * module (`chunks/[node_modules/react-dom/cjs/react-dom-client.production.js].js`), which stays
 * the same between builds unless the chunk's content changes substantially. The build id
 * directory becomes `[build-id]`.
 */
export function nextKeys(
  assets: readonly Asset[],
  buildId: string | undefined,
): Map<string, string> {
  const wanted = assets.map((asset) => {
    let key = asset.key;
    if (buildId !== undefined && asset.file.startsWith(`${buildId}/`)) {
      key = `[build-id]/${asset.file.slice(buildId.length + 1)}`;
    }
    const match = /^(chunks\/(?:.*\/)?)([^/]+)\.js$/.exec(asset.file);
    const dir = match?.[1];
    const stem = match?.[2];
    if (dir !== undefined && stem !== undefined) {
      if (stem.startsWith('turbopack-')) key = `${dir}[turbopack-runtime].js`;
      else if (isHashOnly(stem)) {
        const top = asset.modules?.[0]?.path;
        key = top === undefined ? `${dir}[hash].js` : `${dir}[${top}].js`;
      }
    }
    return { file: asset.file, key, size: asset.raw };
  });
  const groups = new Map<string, typeof wanted>();
  for (const item of wanted) groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
  const keys = new Map<string, string>();
  for (const [key, group] of groups) {
    group.sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
    group.forEach((item, index) => keys.set(item.file, index === 0 ? key : `${key}~${index + 1}`));
  }
  return keys;
}

/** Initial files referenced by a prerendered page (excluding `noModule` legacy polyfills). */
export function htmlAssets(html: string): string[] {
  const files: string[] = [];
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const text = tag[0];
    if (/\bnomodule\b/i.test(text)) continue;
    const isScript = tag[1]?.toLowerCase() === 'script';
    const isPreload =
      /\brel="(?:preload|modulepreload)"/i.test(text) && /\bas="script"/i.test(text);
    const isStylesheet = /\brel="stylesheet"/i.test(text);
    if (!isScript && !isPreload && !isStylesheet) continue;
    const url = /\b(?:src|href)="([^"]+)"/i.exec(text)?.[1];
    if (url?.startsWith(STATIC_PREFIX) === true)
      files.push(decodeURI(url.slice(STATIC_PREFIX.length).split('?')[0] ?? ''));
  }
  return [...new Set(files)];
}

/** `about.html` → `/about`, `index.html` → `/`, `blog/(group)/post.html` → `/blog/post`. */
export function htmlRoute(path: string): string | undefined {
  const parts = path
    .replace(/\.html$/, '')
    .split('/')
    .filter((part) => !/^\(.*\)$/.test(part));
  if (parts.some((part) => SPECIAL.has(part))) return undefined;
  const route = `/${parts.join('/')}`.replace(/\/index$/, '/');
  return route === '' ? '/' : route;
}

async function listRelative(root: string, suffix: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

interface ClientManifest {
  entryJSFiles?: Record<string, string[]>;
}

/** Routes of an App Router build without prerendered HTML, from client reference manifests. */
async function manifestRoutes(
  serverApp: string,
  rootMainFiles: readonly string[],
  skip: ReadonlySet<string>,
) {
  const routes: { route: string; files: string[] }[] = [];
  for (const file of await listRelative(serverApp, 'page_client-reference-manifest.js')) {
    const text = await readFile(join(serverApp, file), 'utf8');
    const json = /=\s*(\{[\s\S]*\});?\s*$/.exec(text)?.[1];
    if (json === undefined) continue;
    let manifest: ClientManifest;
    try {
      manifest = JSON.parse(json) as ClientManifest;
    } catch {
      continue;
    }
    const route = htmlRoute(file.replace(/\/?page_client-reference-manifest\.js$/, '') || 'index');
    if (route === undefined || skip.has(route)) continue;
    const entries = Object.values(manifest.entryJSFiles ?? {}).flat();
    const files = [...rootMainFiles, ...entries].map((f) =>
      f.replace(/^\/?(?:_next\/)?static\//, ''),
    );
    routes.push({ route, files: [...new Set(files)] });
  }
  return routes;
}

/** Measures a built Next.js app (`.next/`), with routes from prerendered pages and manifests. */
export async function measureNextApp(options: MeasureWebAppOptions): Promise<MeasureResult> {
  const staticDir = join(options.outDir, 'static');
  const scan = await scanOutputDir({ outDir: staticDir, appDir: options.appDir });
  const buildId =
    (await readFile(join(options.outDir, 'BUILD_ID'), 'utf8').catch(() => '')).trim() || undefined;
  const keys = nextKeys(scan.assets, buildId);
  const assets = scan.assets.map((asset) => ({ ...asset, key: keys.get(asset.file) ?? asset.key }));
  const keyOf = (file: string) => keys.get(file);

  const routes: Route[] = [];
  const seen = new Set<string>();
  for (const dir of ['server/app', 'server/pages']) {
    const root = join(options.outDir, dir);
    for (const file of await listRelative(root, '.html')) {
      const route = htmlRoute(file);
      if (route === undefined || seen.has(route)) continue;
      seen.add(route);
      const html = await readFile(join(root, file), 'utf8');
      routes.push({
        route,
        assets: htmlAssets(html)
          .map(keyOf)
          .filter((k): k is string => k !== undefined),
      });
    }
  }
  const buildManifest = JSON.parse(
    await readFile(join(options.outDir, 'build-manifest.json'), 'utf8').catch(() => '{}'),
  ) as { rootMainFiles?: string[] };
  const rootMain = (buildManifest.rootMainFiles ?? []).map((f) => f.replace(/^static\//, ''));
  for (const { route, files } of await manifestRoutes(
    join(options.outDir, 'server/app'),
    rootMain,
    seen,
  )) {
    routes.push({ route, assets: files.map(keyOf).filter((k): k is string => k !== undefined) });
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));

  return {
    app: {
      id: options.id,
      name: options.name,
      path: options.path,
      kind: 'web',
      framework: 'next',
      assets,
      routes,
      ...(options.dependencies === undefined ? {} : { dependencies: [...options.dependencies] }),
    },
    warnings: scan.warnings,
  };
}
