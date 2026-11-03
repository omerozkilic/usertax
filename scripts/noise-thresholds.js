// Derives Lighthouse noise thresholds from calibration data (ADR 0007).
//
// For each page and metric, base and head samples of `--runs` runs are drawn from two different
// runners of the same commit (the cached-base situation) and compared the way usertax does:
// a change is "significant" when |head median − base median| > max(floor, k × pooled IQR).
// Since nothing changed, every significant result is a false positive. The script prints the
// false-positive rate for candidate floors. Deterministic (seeded).
//
// Usage: node scripts/noise-thresholds.js docs/benchmarks/data/2026-11-03-lighthouse [--runs 5] [--k 1.5]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write('usage: noise-thresholds.js <calibration dir> [--runs n] [--k k]\n');
  process.exit(2);
}
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const RUNS = arg('--runs', 5);
const K = arg('--k', 1.5);
const TRIALS = 20000;
const CANDIDATES = {
  performance: [0, 0.5, 1, 2],
  lcp: [0, 10, 25, 50],
  tbt: [0, 10, 25, 50],
  cls: [0, 0.005, 0.01],
};

const shards = [1, 2, 3].map((i) => JSON.parse(readFileSync(join(dir, `shard-${i}.json`), 'utf8')));

// mulberry32: small seeded PRNG so the output is reproducible.
let seed = 20261103;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function sample(values, n) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
const median = (v) => quantile(v, 0.5);
const iqr = (v) => quantile(v, 0.75) - quantile(v, 0.25);

const lines = [
  `| Page | Metric | ${'False positives at floor … |'.repeat(1)}`,
  '| --- | --- | --- |',
];
for (const [page, result] of shards[0].results.entries()) {
  for (const [metric, floors] of Object.entries(CANDIDATES)) {
    const runs = shards.map((shard) => shard.results[page].runs.map((run) => run[metric]));
    const rates = floors.map((floor) => {
      let positives = 0;
      for (let t = 0; t < TRIALS; t += 1) {
        const a = Math.floor(random() * 3);
        const b = (a + 1 + Math.floor(random() * 2)) % 3;
        const base = sample(runs[a], RUNS);
        const head = sample(runs[b], RUNS);
        const threshold = Math.max(floor, (K * (iqr(base) + iqr(head))) / 2);
        if (Math.abs(median(head) - median(base)) > threshold) positives += 1;
      }
      return `${floor}: ${((100 * positives) / TRIALS).toFixed(1)} %`;
    });
    lines.push(`| ${result.example} ${result.url} | ${metric} | ${rates.join(' · ')} |`);
  }
}
process.stdout.write(
  `${RUNS} runs per side, k = ${K}, ${TRIALS} trials, base and head from different runners.\n\n${lines.join('\n')}\n`,
);
