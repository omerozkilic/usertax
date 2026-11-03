# Metrics, budgets and noise

This page describes what a usertax report contains, how metrics are named and compared, and how
budgets are written. The report format itself is defined in
[`packages/core/src/schema.ts`](../packages/core/src/schema.ts) and published as JSON Schema in
[`packages/core/schema/report.v1.schema.json`](../packages/core/schema/report.v1.schema.json).

## Units

- Sizes use SI units: 1 kB = 1000 bytes, 1 MB = 1000 kB (the convention of Chrome DevTools).
- gzip sizes use level 9 and brotli sizes use quality 11. Both settings are recorded in every
  report and printed in the PR comment.
- Per-package and per-module sizes are **minified bytes attributed by source maps**. Compression
  does not split additively across packages, so packages are not given compressed sizes.
- For React Native with Hermes, the bundle size is the size of the Hermes bytecode file;
  per-package sizes still come from the source map of the JavaScript that was compiled.
- Mobile archive sizes are the APK / AAB / IPA file size and per-category compressed sizes.
  They are proxies for download size: stores deliver per-device variants (ADR 0009).

## Metric ids

Every number that can be compared or budgeted has a stable id. Free-text parts (routes, URLs,
archive keys) are wrapped in brackets.

| Metric id                                          | Meaning                                                                                                                | Unit     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| `js.total.{raw,gzip,brotli}`                       | All JavaScript files of a web app                                                                                      | bytes    |
| `css.total.{raw,gzip,brotli}`                      | All CSS files of a web app                                                                                             | bytes    |
| `route[<route>].js.{raw,gzip,brotli}`              | JavaScript loaded for one route                                                                                        | bytes    |
| `bundle[<ios\|android>].raw`                       | React Native JS or Hermes bundle                                                                                       | bytes    |
| `archive[<key>].file`                              | APK / AAB / IPA file size                                                                                              | bytes    |
| `archive[<key>].category.<category>`               | Compressed size of one category (`js-bundle`, `dex`, `native`, `resources`, `assets`, `binary`, `frameworks`, `other`) | bytes    |
| `lighthouse[<url>][<mobile\|desktop>].performance` | Lighthouse performance score, 0–100                                                                                    | score    |
| `lighthouse[<url>][<mobile\|desktop>].lcp`         | Largest Contentful Paint                                                                                               | ms       |
| `lighthouse[<url>][<mobile\|desktop>].tbt`         | Total Blocking Time                                                                                                    | ms       |
| `lighthouse[<url>][<mobile\|desktop>].cls`         | Cumulative Layout Shift                                                                                                | unitless |

Lighthouse metrics are the **median** of all runs, computed per metric. The report keeps every
run, and the comment shows the interquartile range (IQR) and the number of runs.

## How changes are judged

Each metric diff has a `significance`:

- `exact`: a deterministic measurement (all sizes). Any change is real.
- `significant` / `within-noise`: a repeated measurement (Lighthouse) whose median changed by
  more / not more than `max(floor, k × pooled IQR)`, where the pooled IQR is the mean of the base
  and head IQRs (ADR 0007).
- `unassessed`: a repeated measurement for which no noise threshold is configured. usertax shows
  the change but does not call it better or worse.
- `not-comparable`: the metric exists on one side only.

Default noise thresholds are not set yet. They will be derived from published calibration
measurements (ADR 0007); until then, configure them explicitly or read Lighthouse changes as
unassessed.

## Budgets

A budget selects metrics with glob patterns (`*` matches anything, `?` one character) and sets
one or more limits. Values can be numbers in the metric's unit or strings with a unit.

```json
{
  "budgets": [
    { "metric": "js.total.gzip", "max": "200 kB" },
    { "metric": "route[*].js.gzip", "maxIncrease": "10 kB", "level": "warn" },
    { "app": "mobile", "metric": "archive[android].file", "maxIncreasePercent": 2 },
    { "metric": "lighthouse[*][mobile].performance", "min": 80, "maxDecrease": 5 }
  ]
}
```

| Field                                       | Meaning                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `app`                                       | Glob over app ids. Default `*`.                               |
| `metric`                                    | Glob over metric ids. Required.                               |
| `max` / `min`                               | Limits on the head value.                                     |
| `maxIncrease` / `maxDecrease`               | Limits on the change from base to head, in the metric's unit. |
| `maxIncreasePercent` / `maxDecreasePercent` | Limits on the relative change, in percent.                    |
| `level`                                     | `fail` (default) or `warn`.                                   |

Units in strings: `B`, `kB`, `MB`, `GB` (SI), `KiB`, `MiB`, `GiB` (binary), `ms`, `s`.

Rules:

- Change limits are **skipped** when there is no base, and percentage limits when the base is 0.
- On noisy metrics, a change that is `within-noise` passes change limits, and an `unassessed`
  change skips them. `max` and `min` always apply to the median.
- A budget whose patterns match no metric is listed in the comment, because it is usually a
  typo.
- The overall status is `fail` if any budget fails, otherwise `warn` if any warns, otherwise
  `pass`.

## Trying it locally

```bash
pnpm build
node packages/cli/bin/usertax.js diff head.json --base base.json
node packages/cli/bin/usertax.js diff head.json --base base.json --format json --compression brotli
```
