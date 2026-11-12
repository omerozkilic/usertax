import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { Route } from '@usertax/core';
import { resolveUrl } from './html-routes.js';

const MANIFEST_FILE = /^manifest-[\w-]{1,64}\.js$/;
export const MANIFEST_PREFIX = 'window.__reactRouterManifest=';
const MAX_ROUTES = 5000;
const MAX_DEPTH = 64;

interface ManifestRoute {
  readonly id: string;
  readonly parentId?: string;
  readonly path?: string;
  readonly index?: boolean;
  readonly module: string;
  readonly imports: readonly string[];
  readonly css: readonly string[];
}

export interface ReactRouterManifest {
  readonly entry: {
    readonly module: string;
    readonly imports: readonly string[];
    readonly css: readonly string[];
  };
  readonly routes: ReadonlyMap<string, ManifestRoute>;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Reads the client manifest of a React Router (framework mode) build,
 * `window.__reactRouterManifest={…};`, which lists every route with the modules it loads. The
 * file is build output, so its shape is checked and anything unexpected gives `undefined`.
 */
export function parseReactRouterManifest(text: string): ReactRouterManifest | undefined {
  if (!text.startsWith(MANIFEST_PREFIX)) return undefined;
  const end = text.lastIndexOf(';');
  let json: unknown;
  try {
    json = JSON.parse(text.slice(MANIFEST_PREFIX.length, end === -1 ? undefined : end));
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null) return undefined;
  const { entry, routes } = json as { entry?: unknown; routes?: unknown };
  if (typeof entry !== 'object' || entry === null) return undefined;
  if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) return undefined;
  const entryFields = entry as Record<string, unknown>;
  if (typeof entryFields['module'] !== 'string') return undefined;
  const parsed = new Map<string, ManifestRoute>();
  for (const [id, raw] of Object.entries(routes).slice(0, MAX_ROUTES)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const route = raw as Record<string, unknown>;
    if (typeof route['module'] !== 'string') continue;
    parsed.set(id, {
      id,
      ...(typeof route['parentId'] === 'string' ? { parentId: route['parentId'] } : {}),
      ...(typeof route['path'] === 'string' ? { path: route['path'] } : {}),
      ...(route['index'] === true ? { index: true } : {}),
      module: route['module'],
      imports: strings(route['imports']),
      css: strings(route['css']),
    });
  }
  return {
    entry: {
      module: entryFields['module'],
      imports: strings(entryFields['imports']),
      css: strings(entryFields['css']),
    },
    routes: parsed,
  };
}

/** The routes of a manifest that render a page: those without child routes. */
export function manifestRoutes(
  manifest: ReactRouterManifest,
): { route: string; chain: ManifestRoute[] }[] {
  const parents = new Set(
    [...manifest.routes.values()].flatMap((route) =>
      route.parentId === undefined ? [] : [route.parentId],
    ),
  );
  const pages: { route: string; chain: ManifestRoute[] }[] = [];
  for (const leaf of manifest.routes.values()) {
    if (parents.has(leaf.id)) continue;
    // A leaf without a path that is not an index route renders nothing on its own.
    if (leaf.path === undefined && leaf.index !== true && leaf.parentId !== undefined) continue;
    const chain: ManifestRoute[] = [];
    for (
      let current: ManifestRoute | undefined = leaf;
      current !== undefined && chain.length < MAX_DEPTH;
      current = current.parentId === undefined ? undefined : manifest.routes.get(current.parentId)
    ) {
      chain.unshift(current);
    }
    const segments = chain.flatMap((route) =>
      (route.path ?? '').split('/').filter((segment) => segment !== ''),
    );
    pages.push({ route: `/${segments.join('/')}`, chain });
  }
  return pages;
}

/**
 * Derives the JavaScript and CSS each route loads from the React Router client manifest: the
 * entry module, and the module and static imports of every route from the root down to the page.
 * Works whether or not the pages were prerendered, so server-rendered apps get routes too.
 *
 * @param keys output file → asset key, from `scanOutputDir`
 * @returns `undefined` when the build has no readable manifest
 */
export async function reactRouterRoutes(
  outDir: string,
  keys: ReadonlyMap<string, string>,
): Promise<Route[] | undefined> {
  const files = new Set(keys.keys());
  let manifest: ReactRouterManifest | undefined;
  for (const file of [...files].filter((f) => MANIFEST_FILE.test(posix.basename(f))).sort()) {
    manifest = parseReactRouterManifest(await readFile(join(outDir, file), 'utf8'));
    if (manifest !== undefined) break;
  }
  if (manifest === undefined) return undefined;
  const entry = manifest.entry;
  const byRoute = new Map<string, Set<string>>();
  for (const { route, chain } of manifestRoutes(manifest)) {
    const urls = [
      entry.module,
      ...entry.imports,
      ...entry.css,
      ...chain.flatMap((r) => [r.module, ...r.imports, ...r.css]),
    ];
    const assets = byRoute.get(route) ?? new Set<string>();
    for (const url of urls) {
      const file = resolveUrl(url, '.', files);
      const key = file === undefined ? undefined : keys.get(file);
      if (key !== undefined) assets.add(key);
    }
    byRoute.set(route, assets);
  }
  return [...byRoute]
    .map(([route, assets]) => ({ route, assets: [...assets] }))
    .sort((a, b) => a.route.localeCompare(b.route));
}
