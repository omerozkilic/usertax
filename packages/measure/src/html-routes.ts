import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { Route } from '@usertax/core';

/** Files followed from one page. A build that reaches more is not a page anyone loads. */
const MAX_FILES = 5000;
const MAX_IMPORTS = 5000;

/** Pages that static hosts serve for unknown paths. They are not routes. */
const FALLBACK_PAGES = new Set(['200.html', '404.html']);

/** Route of a prerendered page: `index.html` → `/`, `a/index.html` → `/a/`, `a.html` → `/a`. */
export function pageRoute(file: string): string {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`;
  return `/${file.slice(0, -'.html'.length)}`;
}

// Build output is attacker-controlled input (a pull request builds its own code), so every
// pattern below is anchored or bounded and cannot backtrack on long input.
const TAG = /<(script|link)\b([^>]{0,4000})>/gi;
const ISLAND_ATTRIBUTE =
  /(?<![\w-])(?:component-url|renderer-url|before-hydration-url)\s*=\s*"([^"]{1,1000})"/g;
const DYNAMIC_IMPORT = /\bimport\(\s*(["'`])([^"'`\\\n]{1,1000})\1\s*\)/g;

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `(?<![\\w-])${name}\\s*=\\s*(?:"([^"]{0,1000})"|'([^']{0,1000})'|([^\\s"'>]{1,1000}))`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/**
 * The scripts, stylesheets and modules a page loads, as written in its HTML: `<script src>`,
 * `<link rel="stylesheet | modulepreload | preload">`, `import("…")` in inline scripts (SvelteKit)
 * and the island attributes of Astro (`component-url`, `renderer-url`).
 */
export function referencedUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const [, name, attributes] of html.matchAll(TAG) as Iterable<[string, string, string]>) {
    if (name.toLowerCase() === 'script') {
      const src = attribute(attributes, 'src');
      if (src !== undefined) urls.add(src);
      continue;
    }
    const rel = (attribute(attributes, 'rel') ?? '').toLowerCase().split(/\s+/);
    const as = (attribute(attributes, 'as') ?? '').toLowerCase();
    const loads =
      rel.includes('stylesheet') ||
      rel.includes('modulepreload') ||
      (rel.includes('preload') && (as === 'script' || as === 'style'));
    const href = loads ? attribute(attributes, 'href') : undefined;
    if (href !== undefined) urls.add(href);
  }
  for (const match of html.matchAll(ISLAND_ATTRIBUTE)) urls.add(match[1] as string);
  for (const match of html.matchAll(DYNAMIC_IMPORT)) urls.add(match[2] as string);
  return [...urls];
}

const IMPORT_STATEMENT =
  /^(?:import|export)\s*(?:(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]{0,1500}\}|[\w$]+(?:\s*,\s*\{[^}]{0,1500}\})?)\s*from\s*)?(["'])([^"'\n]{1,500})\1\s*$/;

function startsStatement(code: string, at: number): boolean {
  let index = at - 1;
  while (index >= 0 && (code[index] === ' ' || code[index] === '\t' || code[index] === '\r'))
    index -= 1;
  return index < 0 || code[index] === ';' || code[index] === '}' || code[index] === '\n';
}

/**
 * The modules a JavaScript file imports statically (`import … from "./x.js"`, `import "./x.js"`,
 * `export … from "./x.js"`), which load with it. Dynamic `import()` calls are not followed: they
 * load later or never. Bundlers write each import as one statement, so this reads statements
 * instead of parsing the file.
 */
export function staticImports(code: string): string[] {
  const found = new Set<string>();
  for (const keyword of ['import', 'export']) {
    let at = code.indexOf(keyword);
    while (at !== -1 && found.size < MAX_IMPORTS) {
      if (startsStatement(code, at)) {
        const window = code.slice(at, at + 2000);
        const end = window.search(/[;\n]/);
        const statement = end === -1 ? window : window.slice(0, end);
        const specifier = IMPORT_STATEMENT.exec(statement)?.[2];
        if (specifier !== undefined && /^(?:\.{1,2}\/|\/)/.test(specifier)) found.add(specifier);
      }
      at = code.indexOf(keyword, at + keyword.length);
    }
  }
  return [...found];
}

/**
 * Finds the file in the build output that a URL refers to, or `undefined` for external URLs and
 * files that are not part of the output.
 *
 * @param pageDir directory of the referencing file, relative to the output root (posix)
 */
export function resolveUrl(
  url: string,
  pageDir: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return undefined;
  const end = url.search(/[?#]/);
  const raw = end === -1 ? url : url.slice(0, end);
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  const rooted = path.startsWith('/');
  const normalized = posix.normalize(rooted ? path.slice(1) : posix.join(pageDir, path));
  if (normalized === '..' || normalized.startsWith('../')) return undefined;
  if (files.has(normalized)) return normalized;
  // The site is served under a base path (`/docs/_astro/x.js`): the longest tail that exists.
  if (rooted) {
    const parts = normalized.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const tail = parts.slice(index).join('/');
      if (files.has(tail)) return tail;
    }
  }
  return undefined;
}

const isScript = (file: string) => file.endsWith('.js') || file.endsWith('.mjs');

/**
 * Derives the JavaScript and CSS each prerendered page loads from its own HTML: the files it
 * references plus the modules those import statically. Used for frameworks that write one HTML
 * file per route and no Vite manifest of their own (Astro, SvelteKit with adapter-static).
 *
 * Inline scripts are part of the HTML file, not of a route's JavaScript. `200.html` and
 * `404.html`, the fallback pages of static hosts, are not routes.
 *
 * @param keys output file → asset key, from `scanOutputDir`
 */
export async function htmlRoutes(
  outDir: string,
  keys: ReadonlyMap<string, string>,
): Promise<Route[] | undefined> {
  const files = new Set(keys.keys());
  const pages = [...files]
    .filter((file) => file.endsWith('.html') && !FALLBACK_PAGES.has(file))
    .sort();
  if (pages.length === 0) return undefined;
  const imports = new Map<string, string[]>();
  const importsOf = async (file: string): Promise<string[]> => {
    const cached = imports.get(file);
    if (cached !== undefined) return cached;
    const dir = posix.dirname(file);
    const code = await readFile(join(outDir, file), 'utf8');
    const resolved = staticImports(code)
      .map((specifier) => resolveUrl(specifier, dir, files))
      .filter((target): target is string => target !== undefined);
    imports.set(file, resolved);
    return resolved;
  };
  const routes: Route[] = [];
  for (const page of pages) {
    const html = await readFile(join(outDir, page), 'utf8');
    const dir = posix.dirname(page);
    const loaded = new Set<string>();
    const queue = referencedUrls(html)
      .map((url) => resolveUrl(url, dir, files))
      .filter((target): target is string => target !== undefined);
    while (queue.length > 0 && loaded.size < MAX_FILES) {
      const file = queue.shift() as string;
      if (loaded.has(file)) continue;
      loaded.add(file);
      if (isScript(file)) queue.push(...(await importsOf(file)));
    }
    routes.push({
      route: pageRoute(page),
      assets: [...loaded]
        .map((file) => keys.get(file))
        .filter((key): key is string => key !== undefined),
    });
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}
