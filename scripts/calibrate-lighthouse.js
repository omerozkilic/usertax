// Measures Lighthouse noise on one machine: every example page is audited `--runs` times on the
// same build, and the raw runs plus summary statistics are written to `--output`. Run it on
// several machines (the calibrate-lighthouse workflow uses separate GitHub-hosted runners) and
// combine the results with scripts/aggregate-calibration.js. See docs/benchmarks/README.md.
//
// Usage: node scripts/calibrate-lighthouse.js --runs 30 --output calibration/shard-1.json
// Needs `pnpm build` and `pnpm build:examples` first.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { summarize } from '../packages/core/dist/index.js';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const runs = Number(arg('--runs', '30'));
const output = arg('--output', 'calibration/local.json');
const cli = new URL('../packages/cli/bin/usertax.js', import.meta.url).pathname;
const targets = [
  { example: 'examples/vite-app', pages: ['/'] },
  { example: 'examples/next-app', pages: ['/'] },
];
const metrics = ['performance', 'lcp', 'tbt', 'cls'];
const work = mkdtempSync(join(tmpdir(), 'usertax-calibrate-'));

const results = [];
for (const { example, pages } of targets) {
  const file = join(work, `${example.replaceAll('/', '-')}.json`);
  const args = [cli, 'measure', example, '--output', file, '--runs', String(runs)];
  for (const page of pages) args.push('--lighthouse', page);
  execFileSync(process.execPath, args, { stdio: 'inherit' });
  const report = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of report.apps[0].lighthouse) {
    const stats = Object.fromEntries(
      metrics.map((metric) => {
        const values = entry.runs.map((run) => run[metric]);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sd = Math.sqrt(
          values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1),
        );
        return [metric, { ...summarize(values), mean, sd }];
      }),
    );
    results.push({
      example,
      url: entry.url,
      formFactor: entry.formFactor,
      lighthouseVersion: entry.lighthouseVersion,
      runs: entry.runs,
      stats,
    });
  }
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      machine: {
        cpus: cpus().length,
        cpu: cpus()[0]?.model ?? 'unknown',
        node: process.version,
        runner: process.env.RUNNER_NAME ?? null,
      },
      runsPerPage: runs,
      results,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`wrote ${output}\n`);
