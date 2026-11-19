import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { describe, expect, it } from 'vitest';
import type { App, Dependency, Report } from '@usertax/core';
import {
  DEFAULT_MAX_LENGTH,
  ReportValidationError,
  diffReports,
  evaluateBudgets,
  parseReportText,
  renderJson,
  renderMarkdown,
} from '@usertax/core';
import { lighthouseApp, mobileApp, modify, report, webApp } from './fixtures.js';

/**
 * Deterministic mutation fuzzing of the untrusted-report path (ADR 0005): a seeded generator
 * damages a valid report, and whatever survives parsing must diff and render without throwing,
 * into Markdown that GitHub renders without raw HTML, foreign links or a second marker.
 * The seed is fixed so a failure reproduces; change `SEED` to explore.
 */
const SEED = 0x5eed;
const ITERATIONS = 400;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTILE_STRINGS = [
  '@everyone <img src=x onerror=alert(1)> [click](https://evil.example)',
  '`](javascript:alert(1))',
  '<!-- usertax:report -->',
  '<script>alert(1)</script>',
  'a|b\n| --- |\n# heading',
  '</details></summary><details><summary>',
  '‮​\u0000\r\n',
  '![x](https://evil.example/p.png)',
  '[ref]: https://evil.example\n[ref]',
  '*'.repeat(50) + '_'.repeat(50),
  '👍🏽'.repeat(200),
  'x'.repeat(1024),
  '',
];
const HOSTILE_NUMBERS = [0, -1, 0.5, 1e308, 2 ** 53, Number.MAX_SAFE_INTEGER, -0, 1e-9];

const dependencies: Dependency[] = [
  { name: 'react', version: '19.3.1', direct: true },
  {
    name: 'moment',
    version: '2.30.1',
    direct: false,
    via: ['react'],
    chain: ['react', 'scheduler'],
  },
];

function richBase(): Report {
  const web = modify(webApp(), (app) => {
    app.dependencies = dependencies;
    const first = app.assets?.[0];
    if (first?.packages?.[0])
      first.packages[0].versions = [
        { version: '1.0.0', bytes: 10 },
        { version: '2.0.0', bytes: 20 },
      ];
  });
  return report([web, mobileApp(), lighthouseApp([{ performance: 90, lcp: 1200 }])]);
}

type Path = (string | number)[];

function leaves(value: unknown, path: Path = [], out: Path[] = []): Path[] {
  out.push(path);
  if (Array.isArray(value)) value.forEach((item, i) => leaves(item, [...path, i], out));
  else if (typeof value === 'object' && value !== null)
    for (const [key, item] of Object.entries(value)) leaves(item, [...path, key], out);
  return out;
}

function at(root: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (value, key) => (value as Record<string | number, unknown>)[key],
    root,
  );
}

function mutate(root: Report, random: () => number): unknown {
  const copy = structuredClone(root) as unknown;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  for (let round = 0, rounds = 1 + Math.floor(random() * 3); round < rounds; round++) {
    const path = pick(leaves(copy).filter((p) => p.length > 0));
    const parent = at(copy, path.slice(0, -1)) as Record<string | number, unknown>;
    const key = path.at(-1) as string | number;
    switch (Math.floor(random() * 8)) {
      case 0:
        parent[key] = pick(HOSTILE_STRINGS);
        break;
      case 1:
        parent[key] = pick(HOSTILE_NUMBERS);
        break;
      case 2:
        parent[key] = pick([null, true, {}, [], [[]], { a: { b: {} } }]);
        break;
      case 3:
        if (Array.isArray(parent)) parent.splice(Number(key), 1);
        else Reflect.deleteProperty(parent, key);
        break;
      case 4:
        if (Array.isArray(parent)) parent.push(structuredClone(parent[Number(key)]));
        else parent[`extra${round}`] = pick(HOSTILE_STRINGS);
        break;
      case 5:
        if (Array.isArray(parent)) parent.reverse();
        else {
          const current = parent[key];
          parent[key] = typeof current === 'string' ? current.repeat(3) : 1;
        }
        break;
      case 6:
        if (typeof parent[key] === 'string') parent[key] += pick(HOSTILE_STRINGS);
        break;
      default:
        parent[key] = structuredClone(at(copy, pick(leaves(copy))));
    }
  }
  return copy;
}

/** Damages the JSON text itself: truncation, flipped and inserted characters. */
function damage(text: string, random: () => number): string {
  const position = Math.floor(random() * text.length);
  switch (Math.floor(random() * 4)) {
    case 0:
      return text.slice(0, position);
    case 1:
      return text.slice(0, position) + text.slice(position + 1 + Math.floor(random() * 20));
    case 2:
      return (
        text.slice(0, position) +
        '{[}]",:\\u'.charAt(Math.floor(random() * 9)) +
        text.slice(position)
      );
    default:
      return text.slice(0, position) + '\u0000\ud800' + text.slice(position);
  }
}

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'code',
  'details',
  'em',
  'h2',
  'h3',
  'li',
  'p',
  'strong',
  'sub',
  'summary',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

function expectSafeMarkdown(markdown: string): void {
  const html = micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
  const tags = [...new Set([...html.matchAll(/<([a-z][a-z0-9]*)/g)].map((m) => m[1] as string))];
  expect(tags.filter((tag) => !ALLOWED_TAGS.has(tag))).toEqual([]);
  for (const href of [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] as string))
    expect(href).toMatch(/^https:\/\/(e18e\.dev|github\.com\/e18e)\//);
  expect(html).not.toMatch(/<img|<script|<iframe|<[^>]*\son\w+\s*=/i);
  expect(markdown.startsWith('<!--')).toBe(true);
  expect(html.match(/<!--/g)).toHaveLength(1);
  expect(markdown.length).toBeLessThanOrEqual(DEFAULT_MAX_LENGTH);
}

describe('fuzzing the untrusted report path', () => {
  const base = richBase();
  const random = mulberry32(SEED);

  it('only ever returns a report or a ReportValidationError, and renders what it accepts safely', () => {
    let accepted = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const text = JSON.stringify(mutate(base, random));
      const input = i % 5 === 4 ? damage(text, random) : text;
      let parsed: Report;
      try {
        parsed = parseReportText(input);
      } catch (error) {
        expect(error, `iteration ${i}`).toBeInstanceOf(ReportValidationError);
        continue;
      }
      accepted += 1;
      const context = `iteration ${i}`;
      for (const [head, other] of [
        [parsed, base],
        [base, parsed],
        [parsed, parsed],
      ] as const) {
        const diff = diffReports(head, other);
        expect(() => renderJson(diff, evaluateBudgets(diff, [])), context).not.toThrow();
        expectSafeMarkdown(renderMarkdown(diff));
      }
    }
    // The generator must reach the renderers often enough to mean something.
    expect(accepted).toBeGreaterThan(ITERATIONS / 10);
  }, 30_000);

  it('survives adversarial values in every free-text field of a valid report', () => {
    // Free text a build can influence; enums, ids, hashes and tool metadata have fixed formats.
    const FREE_TEXT = new Set([
      'name',
      'path',
      'file',
      'key',
      'route',
      'package',
      'version',
      'url',
      'origin',
    ]);
    const hostile = modify(base, (r) => {
      const visit = (value: unknown, inTool: boolean): void => {
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            if (typeof item === 'string') value[index] = HOSTILE_STRINGS[0];
            else visit(item, inTool);
          });
        } else if (typeof value === 'object' && value !== null) {
          const record = value as Record<string, unknown>;
          for (const [key, item] of Object.entries(record)) {
            if (typeof item === 'string') {
              if (FREE_TEXT.has(key) && !inTool && item.length > 0)
                record[key] = HOSTILE_STRINGS[0];
            } else visit(item, inTool || key === 'tool' || key === 'git' || key === 'settings');
          }
        }
      };
      visit(r, false);
    });
    const parsed = parseReportText(JSON.stringify(hostile));
    expect(JSON.stringify(parsed)).toContain('onerror');
    expectSafeMarkdown(renderMarkdown(diffReports(parsed, base)));
    expectSafeMarkdown(renderMarkdown(diffReports(base, parsed)));
  });
});

// Keeps `App` imported for readers of the fixtures above without a type-only lint warning.
export type { App };
