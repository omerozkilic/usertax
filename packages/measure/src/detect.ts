import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Framework } from '@usertax/core';

export interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] };
}

export async function readPackageJson(dir: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as PackageJson;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Detects the framework of an app from its dependencies (ADR 0012). */
export function detectFramework(pkg: PackageJson | undefined): Framework {
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
  if ('next' in deps) return 'next';
  if ('expo' in deps) return 'expo';
  if ('react-native' in deps) return 'react-native';
  // Astro and SvelteKit build with Vite and depend on it, so they come first.
  // `react-router` alone is the library (a Vite app with a router); the framework mode has a CLI.
  if ('@react-router/dev' in deps) return 'react-router';
  if ('nuxt' in deps) return 'nuxt';
  if ('astro' in deps) return 'astro';
  if ('@sveltejs/kit' in deps) return 'sveltekit';
  if ('vite' in deps) return 'vite';
  if ('webpack' in deps) return 'webpack';
  return 'static';
}

/** Default build output directory per framework. */
export const DEFAULT_OUT_DIR: Partial<Record<Framework, string>> = {
  next: '.next',
  expo: 'dist',
  astro: 'dist',
  // Client files; prerendered pages are written here too, the server build is not measured.
  'react-router': 'build/client',
  // `nuxt generate` and `nuxt build` both write the client files and prerendered pages here.
  nuxt: '.output/public',
  // adapter-static writes the whole site here; see FALLBACK_OUT_DIRS for other adapters.
  sveltekit: 'build',
  vite: 'dist',
  webpack: 'dist',
  static: 'dist',
};

/**
 * Directories to try when the default one does not exist. SvelteKit writes its client output to
 * `.svelte-kit/output/client` whatever the adapter is; only adapter-static also copies it, with
 * the prerendered pages, to `build`.
 */
export const FALLBACK_OUT_DIRS: Partial<Record<Framework, readonly string[]>> = {
  sveltekit: ['.svelte-kit/output/client'],
};
