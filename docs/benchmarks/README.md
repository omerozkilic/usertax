# Benchmarks and calibration

Numbers in usertax's documentation come from measurements in this repository. This page lists
how each one is produced.

## Lighthouse noise calibration

Lighthouse lab metrics vary from run to run on the same build, and between machines. ADR 0007
requires the "no significant change" thresholds to come from measurements, not guesses, and
leaves one question open: may a Lighthouse base report measured earlier on another runner be
compared with a head measured now?

The [`calibrate-lighthouse`](../../.github/workflows/calibrate-lighthouse.yml) workflow answers
both with data:

1. Three jobs on separate GitHub-hosted `ubuntu-latest` runners each build the example apps and
   run Lighthouse (mobile, default throttling) `runs` times (default 30) on `/` of
   [`examples/vite-app`](../../examples/vite-app) and [`examples/next-app`](../../examples/next-app)
   ([`scripts/calibrate-lighthouse.js`](../../scripts/calibrate-lighthouse.js)).
2. An aggregate job ([`scripts/aggregate-calibration.js`](../../scripts/aggregate-calibration.js))
   reports, per page and metric, the IQR within each runner and the range of the per-runner
   medians, and uploads every raw run as an artifact.

Run it from the Actions tab (**Calibrate Lighthouse → Run workflow**) or locally on one machine:

```bash
pnpm build && pnpm build:examples
node scripts/calibrate-lighthouse.js --runs 30 --output calibration/local.json
node scripts/aggregate-calibration.js calibration/local.json
```

Results and the thresholds derived from them will be recorded here, with the workflow run that
produced them. Until then usertax ships no default noise thresholds and reports Lighthouse
changes as "noise not assessed".

## Bundle sizes

Bundle and file sizes are deterministic for a given lockfile and build tool. The numbers in the
README come from [`docs/demo`](../demo/README.md) (`pnpm demo`).
