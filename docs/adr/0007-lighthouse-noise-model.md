# 0007. Lighthouse noise model

- Status: Accepted (2026-11-03, after calibration)
- Date: 2026-11-03

## Context

Lighthouse lab results vary between runs on the same commit, and more so between different
machines. A tool that reports "-3 performance points" on a PR that changed only a README
teaches people to ignore it.

## Decision

- Each side is measured `N` times (default 5, configurable). The report stores every run and
  shows the median, the interquartile range (IQR) and min/max per metric: performance score,
  LCP, TBT, CLS.
- A change is reported as a change only if `|Δ median|` exceeds
  `max(absolute floor for the metric, k × pooled IQR)`. Otherwise the comment says "no
  significant change" and shows the raw numbers.
- The defaults for the floors and `k` are **not guessed**. In milestone 4 we run each example
  app 30 or more times on the same commit on GitHub-hosted runners, publish the raw data and the
  script in `docs/benchmarks/`, and derive the defaults from it.
- Open question decided by the same calibration: may the Lighthouse base come from a cached
  report (ADR 0004), measured earlier on a different runner? If cross-runner variance is close
  to within-runner variance, yes. If not, the default is to measure base and head in the same
  job, interleaved (base, head, base, head, …), and a cached base is allowed only with a visible
  warning.
- Throttling and form factor use Lighthouse defaults unless configured and are recorded in the
  report.

## Implementation notes (milestone 4)

- `usertax measure --lighthouse <path> --runs <n>` runs Lighthouse (performance category only,
  default mobile throttling, a fresh Chrome per run, pages interleaved) and stores every run.
  Vite and static output is served by a built-in static server with gzip; Next.js apps are
  started with `next start`; any other server can be started with `--start` and `--base-url`.
- The calibration procedure is implemented as the `calibrate-lighthouse` workflow
  ([docs/benchmarks](../benchmarks/README.md)).

## Calibration result (2026-11-03)

3 GitHub-hosted runners × 30 runs of two example pages
([data and method](../benchmarks/README.md#results-2026-11-03)):

- Cross-runner spread of the medians was below the within-runner IQR for every metric, so a
  cached Lighthouse base report is allowed like any other base report (ADR 0004).
- (Superseded on 2026-11-04, see below.) Default thresholds, `k = 1.5` and floors of 1 point (performance), 25 ms (LCP, TBT) and 0
  (CLS), keep the false-positive rate at or below 0.5 % with 5 runs per side. They are
  `DEFAULT_NOISE_THRESHOLDS` in `@usertax/core` and can be overridden or turned off (`null`) per
  metric in the configuration.

## Cross-runner check (2026-11-04)

The 2026-11-03 floors produced false positives on this repository's own pull requests: 14 real
reports of unchanged pages, each from another runner, disagreed far more than the three
calibration runners had (Next.js TBT medians 43–171 ms). A second calibration run confirmed that
the first run on a runner is consistently slow
([data and method](../benchmarks/README.md#cross-runner-check-2026-11-04)). Decisions:

- The defaults become floors of 2 points (performance), 40 ms (LCP), 130 ms (TBT) and 0 (CLS),
  `k = 1.5`: the smallest tested floors without a false positive on the 182 report pairs and in
  the simulation from six calibration runners. They replace the 2026-11-03 values.
- One unrecorded warm-up run per page precedes the recorded runs (`warmup`, default 1).
- A cached Lighthouse base report stays allowed: with these floors it does not produce false
  positives, and measuring the base in the same job would double the cost of every pull request.
- The thresholds are re-checked with `scripts/cross-runner-noise.js` when new reports or another
  calibration run disagree with them.

## Implementation notes (runs with browser extensions)

- The noise model assumes that repeated runs differ only by measurement noise. A Chrome profile
  with extensions breaks that: an extension's scripts and requests are charged to the page, and
  they differ between machines, so a change between two reports can be the extensions alone.
- A run records `contamination` when the URL lists of the Lighthouse result contain an extension
  scheme. The metrics of that page become `unreliable` in the diff: the change is shown, but it
  gets no verdict, and budgets on it are skipped instead of passing or failing on a value that is
  not the app's. This is separate from `within-noise`, which says the change is too small to
  trust; `unreliable` says the measurement itself is not comparable.
- Only extension schemes count. Other non-web URLs (`chrome://`, `data:`, `blob:`) do not.

## Consequences

- Fewer false alarms, at the cost of more Lighthouse runs.
- Defaults are defensible because they come from published measurements.

## Alternatives considered

- Single run: too noisy.
- Mean and standard deviation: sensitive to outliers that Lighthouse runs often produce.
