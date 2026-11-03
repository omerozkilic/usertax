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

### Results (2026-11-03)

[Workflow run #1](https://github.com/omerozkilic/usertax/actions/runs/41702064735) on `ddbb37c`:
three `ubuntu-latest` runners (2 vCPU AMD EPYC 7763, Node.js 24.22.1), Lighthouse 13.6.0, mobile
form factor with simulated throttling, 30 runs of `/` per page and runner. The raw runs are in
[`data/2026-11-03-lighthouse/`](data/2026-11-03-lighthouse/).

Output of `node scripts/aggregate-calibration.js data/2026-11-03-lighthouse/shard-*.json`:

| Page                    | Metric      | Median of medians | Within-runner IQR (max) | Cross-runner median range | Ratio |
| ----------------------- | ----------- | ----------------: | ----------------------: | ------------------------: | ----: |
| `examples/vite-app` `/` | performance |             100.0 |                     0.0 |                       0.0 |  0.00 |
| `examples/vite-app` `/` | LCP         |          755.4 ms |                  4.6 ms |                    1.9 ms |  0.41 |
| `examples/vite-app` `/` | TBT         |            0.0 ms |                  0.0 ms |                    0.0 ms |  0.00 |
| `examples/vite-app` `/` | CLS         |             0.000 |                   0.000 |                     0.000 |  0.00 |
| `examples/next-app` `/` | performance |              99.0 |                     0.0 |                       0.0 |  0.00 |
| `examples/next-app` `/` | LCP         |          645.1 ms |                 14.7 ms |                    3.1 ms |  0.21 |
| `examples/next-app` `/` | TBT         |           96.0 ms |                  8.8 ms |                    3.0 ms |  0.34 |
| `examples/next-app` `/` | CLS         |             0.000 |                   0.000 |                     0.000 |  0.00 |

Single runs were far from the medians: LCP reached 1406 ms on one runner for the Vite page
(median 755 ms) and TBT 184 ms for the Next.js page (median 97 ms). Medians and IQRs are robust
to such outliers; means and standard deviations are not.

**Cached base reports.** On every page and metric the per-runner medians were closer together
than the IQR within a runner (ratio below 1). A Lighthouse base report measured earlier on
another runner is therefore compared like one measured in the same job, and usertax uses the
cached base for Lighthouse as for sizes (ADR 0004, ADR 0007).

**Default thresholds.** `node scripts/noise-thresholds.js data/2026-11-03-lighthouse` draws 5
runs per side (usertax's default) from two different runners, 20 000 times per page and metric,
and counts how often an unchanged page is reported as significantly changed with
`k = 1.5` and different floors:

| Page                    | Metric      | False positives at floor …                    |
| ----------------------- | ----------- | --------------------------------------------- |
| `examples/vite-app` `/` | performance | 0: 0.0 % · 0.5: 0.0 % · 1: 0.0 % · 2: 0.0 %   |
| `examples/vite-app` `/` | LCP (ms)    | 0: 11.2 % · 10: 0.0 % · 25: 0.0 % · 50: 0.0 % |
| `examples/vite-app` `/` | TBT (ms)    | 0: 0.0 % · 10: 0.0 % · 25: 0.0 % · 50: 0.0 %  |
| `examples/vite-app` `/` | CLS         | 0: 0.0 % · 0.005: 0.0 % · 0.01: 0.0 %         |
| `examples/next-app` `/` | performance | 0: 2.9 % · 0.5: 3.0 % · 1: 0.0 % · 2: 0.0 %   |
| `examples/next-app` `/` | LCP (ms)    | 0: 11.3 % · 10: 7.1 % · 25: 0.1 % · 50: 0.0 % |
| `examples/next-app` `/` | TBT (ms)    | 0: 11.9 % · 10: 1.5 % · 25: 0.5 % · 50: 0.6 % |
| `examples/next-app` `/` | CLS         | 0: 0.0 % · 0.005: 0.0 % · 0.01: 0.0 %         |

The defaults are the smallest floors tested that keep every rate at or below 0.5 %:

| Metric      |   Floor |   k |
| ----------- | ------: | --: |
| performance | 1 point | 1.5 |
| LCP         |   25 ms | 1.5 |
| TBT         |   25 ms | 1.5 |
| CLS         |       0 | 1.5 |

Limits: two small pages, one runner type, one day. CLS did not vary at all, so its floor is not
supported by data and stays at 0; heavier pages have larger IQRs, which the `k × IQR` term
follows. Override any of them with `noise` in [the configuration](../configuration.md), and
re-run the workflow when Lighthouse or the runner images change.

## Bundle sizes

Bundle and file sizes are deterministic for a given lockfile and build tool. The numbers in the
README come from [`docs/demo`](../demo/README.md) (`pnpm demo`).
