import { alternativesFor } from './alternatives.js';
import type { Alternatives } from './alternatives.js';
import type { App, Dependency, Report } from './schema.js';

/** Bytes of one package in one shipped file (web asset or React Native bundle). */
export interface PackageInFile {
  /** Stable asset key, or `bundle[<platform>]` for a React Native bundle. */
  readonly key: string;
  readonly file: string;
  /** Minified bytes attributed through the source map (Hermes: bytecode bytes). */
  readonly bytes: number;
}

export interface PackageInApp {
  readonly appId: string;
  readonly appName: string;
  readonly files: readonly PackageInFile[];
  /** Sum of `files`. */
  readonly bytes: number;
  /** Lockfile entries for the package (one per resolved version). */
  readonly dependencies: readonly Dependency[];
}

export interface PackageExplanation {
  readonly name: string;
  readonly head: readonly PackageInApp[];
  /** Present when a base report was given. */
  readonly base?: readonly PackageInApp[];
  /** Curated alternatives (ADR 0008), when the dataset has any. */
  readonly alternatives?: Alternatives;
}

function inApp(app: App, name: string): PackageInApp | undefined {
  const files: PackageInFile[] = [];
  for (const asset of app.assets ?? []) {
    const bytes = asset.packages?.find((p) => p.name === name)?.bytes;
    if (bytes !== undefined) files.push({ key: asset.key, file: asset.file, bytes });
  }
  for (const bundle of app.bundles ?? []) {
    const bytes = bundle.packages?.find((p) => p.name === name)?.bytes;
    if (bytes !== undefined)
      files.push({ key: `bundle[${bundle.platform}]`, file: bundle.file, bytes });
  }
  const dependencies = (app.dependencies ?? []).filter((d) => d.name === name);
  if (files.length === 0 && dependencies.length === 0) return undefined;
  files.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
  return {
    appId: app.id,
    appName: app.name,
    files,
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
    dependencies,
  };
}

function inReport(report: Report, name: string): PackageInApp[] {
  return report.apps.flatMap((app) => inApp(app, name) ?? []);
}

/**
 * Where a package ends up in a report (and optionally a base report): bytes per file from source
 * maps, lockfile versions and the dependencies that pull it in, and curated alternatives. Pure
 * data; both reports must already be validated.
 */
export function explainPackage(name: string, head: Report, base?: Report): PackageExplanation {
  const alternatives = alternativesFor(name);
  return {
    name,
    head: inReport(head, name),
    ...(base === undefined ? {} : { base: inReport(base, name) }),
    ...(alternatives === undefined ? {} : { alternatives }),
  };
}
