# 0007. Lighthouse noise model

- Status: Proposed (thresholds to be set from calibration measurements in milestone 4)
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

## Consequences

- Fewer false alarms, at the cost of more Lighthouse runs.
- Defaults are defensible because they come from published measurements.

## Alternatives considered

- Single run: too noisy.
- Mean and standard deviation: sensitive to outliers that Lighthouse runs often produce.
