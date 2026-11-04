// Checks Lighthouse noise thresholds against real usertax reports of unchanged code measured on
// different GitHub-hosted runners (ADR 0007). Every ordered pair of reports is compared with
// usertax's own diff, as a cached base and a pull request head would be; since the measured
// pages did not change, every "significant" Lighthouse change is a false positive.
//
// Usage: node scripts/cross-runner-noise.js docs/benchmarks/data/2026-11-04-dogfood
//        [--thresholds '{"tbt":{"floor":130,"k":1.5}}']   (merged over the defaults)
// Run `pnpm build` first.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_NOISE_THRESHOLDS, diffReports, parseReport } from '../packages/core/dist/index.js';

const args = process.argv.slice(2);
const dir = args[0];
if (dir === undefined) {
  process.stderr.write('usage: cross-runner-noise.js <reports dir> [--thresholds <json>]\n');
  process.exit(2);
}
const index = args.indexOf('--thresholds');
const overrides = index === -1 ? {} : JSON.parse(args[index + 1] ?? '{}');
const noise = { ...DEFAULT_NOISE_THRESHOLDS, ...overrides };

const reports = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => parseReport(JSON.parse(readFileSync(join(dir, f), 'utf8'))));

const positives = new Map();
let pairs = 0;
for (const [i, head] of reports.entries()) {
  for (const [j, base] of reports.entries()) {
    if (i === j) continue;
    pairs += 1;
    for (const app of diffReports(head, base, { noise }).apps) {
      for (const metric of app.metrics) {
        if (!metric.id.startsWith('lighthouse[')) continue;
        const key = `${app.path} ${metric.id}`;
        positives.set(
          key,
          (positives.get(key) ?? 0) + (metric.significance === 'significant' ? 1 : 0),
        );
      }
    }
  }
}
const lines = ['| Page and metric | False positives |', '| --- | --: |'];
for (const [key, count] of [...positives].sort()) {
  lines.push(`| ${key} | ${count} of ${pairs} (${((100 * count) / pairs).toFixed(1)} %) |`);
}
process.stdout.write(
  `${reports.length} reports, ${pairs} ordered pairs. Thresholds: ${JSON.stringify(noise)}\n\n${lines.join('\n')}\n`,
);
