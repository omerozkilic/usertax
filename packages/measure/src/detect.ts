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
  if ('vite' in deps) return 'vite';
  if ('webpack' in deps) return 'webpack';
  return 'static';
}

/** Default build output directory per framework. */
export const DEFAULT_OUT_DIR: Partial<Record<Framework, string>> = {
  next: '.next',
  vite: 'dist',
  webpack: 'dist',
  static: 'dist',
};
