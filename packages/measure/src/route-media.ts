import { readFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import type { Route } from '@usertax/core';
import { resolveUrl } from './html-routes.js';
import { assetType } from './web.js';

/** URLs read from one page or stylesheet. More is not a page anyone loads. */
const MAX_URLS = 2000;
/** Inline `<style>` blocks read from one page. */
const MAX_STYLE_BLOCKS = 200;
/** Asset keys a route may list (the report schema's limit). */
const MAX_ROUTE_ASSETS = 1000;

// Build output is attacker-controlled input (a pull request builds its own code), so every
// pattern below is bounded and its alternatives are disjoint: none can backtrack on long input.
const MEDIA_TAG = /<(img|link|video)\b([^>]{0,4000})>/gi;
const CSS_URL = /url\(\s*(?:"([^"]{1,2048})"|'([^']{1,2048})'|([^\s"')]{1,2048}))\s*\)/gi;

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `(?<![\\w-])${name}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\\s"'>]{1,2000}))`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function cssUrls(css: string): string[] {
  const urls: string[] = [];
  for (const match of css.matchAll(CSS_URL)) {
    urls.push((match[1] ?? match[2] ?? match[3]) as string);
    if (urls.length >= MAX_URLS) break;
  }
  return urls;
}

/**
 * The images and fonts a stylesheet references: the first source of each `@font-face` rule (a
 * browser downloads the first format it supports, so later ones are fallbacks) and every other
 * `url()`, such as background images.
 */
export function stylesheetMediaUrls(css: string): string[] {
  const urls: string[] = [];
  let rest = '';
  let at = 0;
  for (;;) {
    const start = css.indexOf('@font-face', at);
    if (start === -1) break;
    const open = css.indexOf('{', start);
    const close = open === -1 ? -1 : css.indexOf('}', open);
    if (close === -1) break;
    rest += css.slice(at, start);
    const block = css.slice(open + 1, close);
    const src = /(?:^|[;\s])src\s*:/i.exec(block);
    const first = src === null ? undefined : cssUrls(block.slice(src.index))[0];
    if (first !== undefined) urls.push(first);
    at = close + 1;
  }
  rest += css.slice(at);
  return [...urls, ...cssUrls(rest)].slice(0, MAX_URLS);
}

/**
 * The images and fonts a page references in its HTML: `<img src>` (for responsive images the
 * `src` fallback, or the first `srcset` candidate without one), `<video poster>`, icons,
 * `<link rel="preload">` of images and fonts, and the stylesheet URLs of inline `<style>` blocks.
 * `<source>` elements of a `<picture>` are alternatives to its `<img>` and are not counted.
 */
export function pageMediaUrls(html: string): string[] {
  const urls: string[] = [];
  for (const [, name, attributes] of html.matchAll(MEDIA_TAG) as Iterable<
    [string, string, string]
  >) {
    const tag = name.toLowerCase();
    if (tag === 'img') {
      const src =
        attribute(attributes, 'src') ?? attribute(attributes, 'srcset')?.trim().split(/[\s,]/)[0];
      if (src !== undefined && src !== '') urls.push(src);
    } else if (tag === 'video') {
      const poster = attribute(attributes, 'poster');
      if (poster !== undefined) urls.push(poster);
    } else {
      const rel = (attribute(attributes, 'rel') ?? '').toLowerCase().split(/\s+/);
      const as = (attribute(attributes, 'as') ?? '').toLowerCase();
      const media =
        rel.includes('icon') ||
        rel.includes('apple-touch-icon') ||
        (rel.includes('preload') && (as === 'image' || as === 'font'));
      const href = media ? attribute(attributes, 'href') : undefined;
      if (href !== undefined) urls.push(href);
    }
    if (urls.length >= MAX_URLS) return urls;
  }
  const lower = html.toLowerCase();
  let at = 0;
  for (let blocks = 0; blocks < MAX_STYLE_BLOCKS; blocks += 1) {
    const start = lower.indexOf('<style', at);
    if (start === -1) break;
    const open = html.indexOf('>', start);
    const close = open === -1 ? -1 : lower.indexOf('</style', open);
    if (close === -1) break;
    urls.push(...stylesheetMediaUrls(html.slice(open + 1, close)));
    at = close;
  }
  return urls.slice(0, MAX_URLS);
}

export interface RouteMediaOptions {
  /** Root of the output files that `keys` lists. */
  readonly outDir: string;
  /** Output file (relative to `outDir`) → asset key. */
  readonly keys: ReadonlyMap<string, string>;
  /** The prerendered HTML of a route, as an absolute path, when there is one. */
  readonly pageOf?: (route: string) => string | undefined;
}

const isMedia = (file: string) => {
  const type = assetType(file);
  return type === 'image' || type === 'font';
};

/**
 * Adds the images and fonts that each route's HTML and stylesheets reference to its assets, from
 * the build output only. Files outside the output (other hosts, `data:` URLs) are not counted.
 */
export async function addRouteMedia(
  routes: readonly Route[],
  options: RouteMediaOptions,
): Promise<Route[]> {
  const files = new Set(options.keys.keys());
  const fileOf = new Map([...options.keys].map(([file, key]) => [key, file]));
  const fromStylesheet = new Map<string, string[]>();
  const stylesheetMedia = async (file: string): Promise<string[]> => {
    const cached = fromStylesheet.get(file);
    if (cached !== undefined) return cached;
    const css = await readFile(join(options.outDir, file), 'utf8');
    const found = stylesheetMediaUrls(css)
      .map((url) => resolveUrl(url, posix.dirname(file), files))
      .filter((target): target is string => target !== undefined && isMedia(target));
    fromStylesheet.set(file, found);
    return found;
  };
  const result: Route[] = [];
  for (const route of routes) {
    const media = new Set<string>();
    for (const key of route.assets) {
      const file = fileOf.get(key);
      if (file !== undefined && assetType(file) === 'css') {
        for (const target of await stylesheetMedia(file)) media.add(target);
      }
    }
    const page = options.pageOf?.(route.route);
    if (page !== undefined) {
      const html = await readFile(page, 'utf8');
      const dir = posix.dirname(relative(options.outDir, page).split(sep).join('/'));
      for (const url of pageMediaUrls(html)) {
        const target = resolveUrl(url, dir, files);
        if (target !== undefined && isMedia(target)) media.add(target);
      }
    }
    const added = [...media]
      .map((file) => options.keys.get(file))
      .filter((key): key is string => key !== undefined && !route.assets.includes(key));
    added.splice(Math.max(0, MAX_ROUTE_ASSETS - route.assets.length));
    result.push(added.length === 0 ? route : { ...route, assets: [...route.assets, ...added] });
  }
  return result;
}
