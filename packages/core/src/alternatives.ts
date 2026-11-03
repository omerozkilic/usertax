import data from './data/alternatives.json' with { type: 'json' };

/** Where suggested alternatives come from. Every suggestion cites this source (ADR 0008). */
export const ALTERNATIVES_SOURCE: {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly url: string;
} = data.source;

export interface Alternatives {
  readonly replacements: readonly string[];
  /** Documentation of the replacement, from the dataset. */
  readonly url: string;
  /** `name@version` of the dataset. */
  readonly source: string;
}

const entries = data.entries as Record<string, { replacements: string[]; url: string } | undefined>;

/** Curated alternatives for an npm package, or undefined when the dataset has none. */
export function alternativesFor(name: string): Alternatives | undefined {
  const entry = Object.hasOwn(entries, name) ? entries[name] : undefined;
  if (entry === undefined) return undefined;
  return {
    replacements: entry.replacements,
    url: entry.url,
    source: `${ALTERNATIVES_SOURCE.name}@${ALTERNATIVES_SOURCE.version}`,
  };
}
