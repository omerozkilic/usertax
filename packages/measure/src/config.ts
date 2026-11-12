import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { ConfigError, parseConfig } from '@usertax/core';
import type { Config, Framework } from '@usertax/core';
import { detectFramework, readPackageJson } from './detect.js';

export const CONFIG_FILES = [
  'usertax.config.json',
  'usertax.config.ts',
  'usertax.config.mjs',
  'usertax.config.js',
] as const;

export interface LoadedConfig {
  readonly file: string;
  readonly config: Config;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() === true;
}

/**
 * Loads the configuration from `file`, or from the first `usertax.config.*` in `root`.
 * TypeScript configs rely on Node's built-in type stripping (Node 22.18+).
 */
export async function loadConfig(root: string, file?: string): Promise<LoadedConfig | undefined> {
  let path: string | undefined;
  if (file !== undefined) {
    path = resolve(root, file);
    if (!(await exists(path))) throw new ConfigError(`configuration file ${path} not found`);
  } else {
    for (const name of CONFIG_FILES) {
      if (await exists(join(root, name))) {
        path = join(root, name);
        break;
      }
    }
  }
  if (path === undefined) return undefined;
  let raw: unknown;
  if (path.endsWith('.json')) {
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new ConfigError(`${path} is not valid JSON`);
    }
  } else {
    try {
      raw = ((await import(pathToFileURL(path).href)) as { default?: unknown }).default;
    } catch (error) {
      throw new ConfigError(
        `cannot load ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { file: path, config: parseConfig(raw, path) };
}

async function expand(root: string, patterns: readonly string[]): Promise<string[]> {
  const dirs = new Set<string>();
  for (const raw of patterns) {
    if (raw.startsWith('!')) continue;
    const pattern = raw.replace(/\/+$/, '');
    if (pattern.endsWith('/**') || pattern.endsWith('/*')) {
      const base = pattern.replace(/\/\*\*?$/, '');
      const deep = pattern.endsWith('/**');
      const walk = async (dir: string, depth: number) => {
        const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.'))
            continue;
          const child = `${dir}/${entry.name}`;
          dirs.add(child);
          if (deep && depth < 4) await walk(child, depth + 1);
        }
      };
      await walk(base, 0);
    } else if (!pattern.includes('*')) {
      dirs.add(pattern);
    }
  }
  return [...dirs].sort();
}

/** Workspace package directories from pnpm-workspace.yaml or the `workspaces` field. */
export async function workspaceDirs(root: string): Promise<string[]> {
  const pnpm = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8').catch(() => undefined);
  if (pnpm !== undefined) {
    const packages = (parse(pnpm) as { packages?: string[] } | null)?.packages ?? [];
    return expand(root, packages);
  }
  const manifest = await readPackageJson(root);
  const declared = manifest?.workspaces;
  const patterns: readonly string[] =
    declared === undefined
      ? []
      : 'packages' in declared
        ? (declared.packages ?? [])
        : (declared as readonly string[]);
  return expand(root, patterns);
}

export interface DiscoveredApp {
  /** Directory relative to the repository root (`.` for the root). */
  readonly path: string;
  readonly framework: Framework;
  readonly name?: string;
}

const MEASURABLE: ReadonlySet<Framework> = new Set([
  'vite',
  'next',
  'react-router',
  'nuxt',
  'astro',
  'sveltekit',
  'webpack',
  'expo',
  'react-native',
]);

/**
 * Apps of a repository without configuration (ADR 0012): every workspace package (and the root
 * of a single-package repository) whose dependencies name a supported framework.
 */
export async function discoverApps(root: string): Promise<DiscoveredApp[]> {
  const dirs = await workspaceDirs(root);
  const candidates = dirs.length > 0 ? dirs : ['.'];
  const apps: DiscoveredApp[] = [];
  for (const path of candidates) {
    const manifest = await readPackageJson(join(root, path));
    if (manifest === undefined) continue;
    const framework = detectFramework(manifest);
    if (!MEASURABLE.has(framework)) continue;
    apps.push({ path, framework, ...(manifest.name === undefined ? {} : { name: manifest.name }) });
  }
  return apps;
}
