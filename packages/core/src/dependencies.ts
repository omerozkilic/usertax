import type { Dependency } from './schema.js';

export type DependencyChangeKind = 'added' | 'removed' | 'upgraded' | 'downgraded' | 'changed';

/** How one package's resolved versions changed between base and head lockfiles. */
export interface DependencyChange {
  readonly name: string;
  readonly kind: DependencyChangeKind;
  readonly base: readonly string[];
  readonly head: readonly string[];
  /** Declared directly by the app (on the side where it exists, head preferred). */
  readonly direct: boolean;
  /** Only reachable through dev dependencies. */
  readonly dev: boolean;
  readonly via?: readonly string[];
  /** The shortest chain from a direct dependency to the package that depends on this one. */
  readonly chain?: readonly string[];
}

interface Parsed {
  readonly numbers: readonly number[];
  readonly pre: string;
}

function parse(version: string): Parsed | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version);
  if (!match) return undefined;
  return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' };
}

/** Compares two semver versions; falls back to string comparison for anything else. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (pa === undefined || pb === undefined) return a.localeCompare(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.numbers[i] ?? 0) - (pb.numbers[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1;
  if (pb.pre === '') return -1;
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true });
}

function group(dependencies: readonly Dependency[] | undefined): Map<string, Dependency[]> {
  const byName = new Map<string, Dependency[]>();
  for (const dependency of dependencies ?? []) {
    const list = byName.get(dependency.name) ?? [];
    list.push(dependency);
    byName.set(dependency.name, list);
  }
  return byName;
}

function versions(entries: readonly Dependency[] | undefined): string[] {
  return [...new Set((entries ?? []).map((d) => d.version))].sort(compareVersions);
}

/** Lockfile-level changes between two dependency snapshots, sorted by name. */
export function diffDependencies(
  base: readonly Dependency[] | undefined,
  head: readonly Dependency[] | undefined,
): DependencyChange[] {
  const before = group(base);
  const after = group(head);
  const changes: DependencyChange[] = [];
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = versions(before.get(name));
    const h = versions(after.get(name));
    if (b.join('\n') === h.join('\n')) continue;
    let kind: DependencyChangeKind = 'changed';
    if (b.length === 0) kind = 'added';
    else if (h.length === 0) kind = 'removed';
    else if (b.length === 1 && h.length === 1) {
      kind = compareVersions(h[0] as string, b[0] as string) > 0 ? 'upgraded' : 'downgraded';
    }
    const entries = after.get(name) ?? before.get(name) ?? [];
    const via = [...new Set(entries.flatMap((d) => d.via ?? []))].sort().slice(0, 3);
    // A version that is a direct dependency or one step away needs no chain; show one only when
    // every version is further away, and then the shortest.
    const steps = (d: Dependency) =>
      d.direct ? 0 : (d.chain?.length ?? (d.via === undefined ? Infinity : 1));
    const nearest = [...entries].sort((a, b) => steps(a) - steps(b))[0];
    const chain = nearest?.direct === true ? undefined : nearest?.chain;
    changes.push({
      name,
      kind,
      base: b,
      head: h,
      direct: entries.some((d) => d.direct),
      dev: entries.every((d) => d.dev === true),
      ...(via.length > 0 ? { via } : {}),
      ...(chain === undefined ? {} : { chain }),
    });
  }
  return changes;
}
