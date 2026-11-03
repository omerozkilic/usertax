// Combines calibration files from several machines (scripts/calibrate-lighthouse.js) into:
//
// - within-machine noise: the IQR of each metric on each machine;
// - cross-machine spread: how far the per-machine medians are apart.
//
// If cross-machine spread is close to within-machine noise, a base report measured earlier on
// another runner is good enough for Lighthouse (ADR 0004 / 0007); if not, base and head must be
// measured in the same job. Prints Markdown and writes the combined JSON to `--output`.
//
// Usage: node scripts/aggregate-calibration.js calibration/shard-*.json --output calibration/summary.json
import { readFileSync, writeFileSync } from 'node:fs';

const outputIndex = process.argv.indexOf('--output');
const output = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
const files = process.argv
  .slice(2)
  .filter((file, index, all) => file !== '--output' && all[index - 1] !== '--output');
if (files.length === 0) {
  process.stderr.write(
    'usage: aggregate-calibration.js <calibration.json>... [--output summary.json]\n',
  );
  process.exit(2);
}
const shards = files.map((file) => ({ file, ...JSON.parse(readFileSync(file, 'utf8')) }));
const metrics = ['performance', 'lcp', 'tbt', 'cls'];
const units = { performance: '', lcp: ' ms', tbt: ' ms', cls: '' };
const fmt = (metric, value) =>
  (metric === 'cls' ? value.toFixed(3) : value.toFixed(1)) + units[metric];

const pages = new Map();
for (const shard of shards) {
  for (const result of shard.results) {
    const key = `${result.example} ${result.url} (${result.formFactor})`;
    const list = pages.get(key) ?? [];
    list.push({ machine: shard.machine, stats: result.stats });
    pages.set(key, list);
  }
}

const summary = [];
const lines = [
  '## Lighthouse calibration',
  '',
  `${shards.length} machine(s), ${shards[0]?.runsPerPage ?? '?'} runs per page each.`,
  '',
  '| Page | Metric | Median of medians | Within-machine IQR (max) | Cross-machine median range | Ratio |',
  '| --- | --- | --: | --: | --: | --: |',
];
for (const [page, entries] of pages) {
  for (const metric of metrics) {
    const medians = entries.map((e) => e.stats[metric].median).sort((a, b) => a - b);
    const iqrs = entries.map((e) => e.stats[metric].iqr);
    const maxIqr = Math.max(...iqrs);
    const range = (medians.at(-1) ?? 0) - (medians[0] ?? 0);
    const ratio = maxIqr === 0 ? (range === 0 ? 0 : Number.POSITIVE_INFINITY) : range / maxIqr;
    const middle = medians[Math.floor((medians.length - 1) / 2)] ?? 0;
    summary.push({ page, metric, medians, iqrs, maxIqr, range, ratio });
    lines.push(
      `| ${page} | ${metric} | ${fmt(metric, middle)} | ${fmt(metric, maxIqr)} | ${fmt(metric, range)} | ${Number.isFinite(ratio) ? ratio.toFixed(2) : '∞'} |`,
    );
  }
}
lines.push(
  '',
  'Ratio = cross-machine median range / largest within-machine IQR. Around 1 or below: machines agree within normal run-to-run noise.',
);
process.stdout.write(`${lines.join('\n')}\n`);
if (output !== undefined) writeFileSync(output, `${JSON.stringify({ files, summary }, null, 2)}\n`);
