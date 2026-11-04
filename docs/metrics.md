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

The default thresholds come from published measurements on GitHub-hosted runners
([docs/benchmarks](benchmarks/README.md)): `k = 1.5` with floors of 2 points for the performance
score, 40 ms for LCP, 130 ms for TBT and 0 for CLS. They cover the difference between two
runners, because the base report usually comes from an earlier run on another machine. Override
them, or turn a metric off with `null`, under `noise` in the configuration. Every page gets one
unrecorded warm-up run before the recorded runs (`warmup`, default 1), because the first run
after a server starts is consistently slower.

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

## Web bundles

`usertax measure` reads the build output directory of an app that is already built:

- Every shipped file is measured (raw, gzip, brotli). Source maps, `.LICENSE.txt` files and
  dot-directories such as `.vite/` are skipped.
- Content hashes in file names are replaced by `[hash]` so files can be matched between builds
  (see `packages/measure/src/hash.ts` for the exact rule and its limits).
- JavaScript files are attributed byte by byte through their source map (a
  `sourceMappingURL` comment, an inline map, or a `<file>.map` next to the file). Every byte ends
  up in a package, in first-party code, or in `unattributedBytes`; the three add up to the file
  size. `unattributedBytes` holds bytes that no mapping covers, and bytes mapped to a _foreign_
  source: a path outside the app directory that is not in `node_modules` and exists neither on
  disk nor inside the repository. Foreign sources appear when a bundler chains a dependency's own
  source map without rebasing its paths; usertax cannot tell which package they belong to and
  does not count them as your code.
- webpack source paths (`webpack://<namespace>/…`) are resolved against the webpack context (the
  app root); the webpack runtime and ignored or generated modules are shown as `(virtual)`.
- For Vite, `.vite/manifest.json` (`build.manifest: true`) maps each HTML entry to the files it
  loads initially. Those become routes: `index.html` → `/`, `about/index.html` → `/about/`.
  Dynamic imports are not part of a route's initial JS.
- For Next.js (`.next/`, `productionBrowserSourceMaps: true`), routes come from the script and
  stylesheet tags of the prerendered pages, which is exactly what a browser loads first; legacy
  `noModule` polyfills are excluded. Pages without prerendered HTML use the client reference
  manifest. `basePath` and `assetPrefix` are supported: the static files are found after
  either prefix. Both bundlers are supported:
  - Turbopack (the default): chunk names are only hashes, so a chunk is identified by its largest
    source module, e.g.
    `chunks/[node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js].js`.
    Next.js bundles its own copy of React, so React's bytes are attributed to the `next` package.
  - webpack (`next build --webpack`): chunk names keep their stable part, e.g.
    `chunks/framework-[hash].js`. Next.js's webpack build maps Next.js's own client code to its
    original TypeScript sources (`../../src/client/…`), which are foreign sources: those bytes are
    reported as unattributed, not as `next` and not as your code. Packages in `node_modules`
    (React in `framework-[hash].js`, your dependencies) are attributed as usual.

## React Native and Expo

```bash
npx expo export --platform all --source-maps            # Expo: usertax finds the bundles in dist/
usertax measure apps/mobile --archive app-release.apk --archive App.ipa

usertax measure apps/bare --bundle android=dist/index.android.bundle --bundle ios=dist/main.jsbundle
```

usertax never builds a mobile app; it reads what your build produced.

> [!TIP]
> Export one platform at a time for exact comparisons. With Expo 58,
> `expo export --platform all` builds both platforms in parallel and is not byte-for-byte
> reproducible: on the unchanged [`examples/expo-app`](../examples/expo-app) it produced two
> different pairs of Hermes bundles in four runs (Android 1,250,708 or 1,250,656 bytes, iOS
> 1,246,572 or 1,246,608 bytes), so pull requests showed bundle changes of a few dozen bytes
> without a code change. Each platform exported on its own gave the same bundle in four out of
> four runs. The example exports Android into `dist/` and copies the iOS bundle next to it
> ([`export.mjs`](../examples/expo-app/export.mjs)).

- **Bundles.** Each bundle is measured with its source map (`<file>.map`). Plain JavaScript
  bundles are attributed byte by byte like web bundles, and also get gzip and brotli sizes.
  For **Hermes bytecode**, the source map's generated columns are bytecode offsets, so the
  bytes from one mapping to the next are attributed to that mapping's module. Headers, string
  tables and the last mapping of each function block have no known source and are counted as
  unattributed; the three parts still add up to the file size. Metro's indexed source maps
  (with `sections`) are supported.
- **Archives.** APK, AAB and IPA files are read through their ZIP central directory without
  extracting them, including ZIP64. Entries are grouped into `dex`, `native`, `resources`,
  `assets`, `js-bundle`, `binary`, `frameworks` and `other` (see
  `packages/measure/src/archive.ts`), and the comment lists the entries that changed most. The
  file size and compressed sizes are proxies for download size: stores deliver per-device
  variants (ADR 0009).

## Lighthouse

```bash
usertax measure examples/vite-app --lighthouse / --lighthouse /about/ --runs 5
usertax measure examples/next-app --lighthouse / --runs 5            # starts next start itself
usertax measure . --lighthouse / --start "pnpm preview" --base-url http://127.0.0.1:4173
```

- Only the performance category runs, with Lighthouse's default mobile settings (simulated
  throttling) unless `--form-factor desktop` is given. Settings and the Lighthouse version are
  recorded in the report.
- Every run uses a fresh Chrome; with several pages, runs alternate between pages.
- Vite, webpack and static output is served by a built-in static server that gzips text like a
  static host; Next.js apps are started with `next start` on a free port.
- The report keeps every run. Comparisons use per-metric medians and show the IQR and the number
  of runs.
- Lighthouse and chrome-launcher are optional dependencies; install them where you run
  `usertax measure --lighthouse`.

## Why a package changed

When both reports carry a dependency snapshot (`usertax measure` reads the nearest
`pnpm-lock.yaml`, `package-lock.json` / `npm-shrinkwrap.json` or `yarn.lock`), each package in
the comment gets a reason:

| Reason                                         | Meaning                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `added 2.30.1 (direct)`                        | The app now declares the package.                                                     |
| `added 1.2.0 via x`                            | A transitive dependency, pulled in by the direct dependency or workspace package `x`. |
| `upgraded 4.17.20 → 4.17.21`                   | One resolved version on each side.                                                    |
| `versions a → a, b`                            | Several versions are installed (duplicates).                                          |
| `removed …`                                    | No longer in the lockfile.                                                            |
| `same version; more or less of it is imported` | The lockfile did not change for this package; the app imports a different part of it. |

Lockfile changes that do not change any bundle (dev tooling, packages that are not bundled) are
listed separately in a collapsed section.

Supported lockfiles: pnpm 6.x and 9.x, npm lockfile versions 2 and 3, Yarn 1 and Yarn 2+.
Workspace links are followed, so a dependency of a workspace package used by the app is reported
as coming "via" that package. Yarn 1 lockfiles do not record workspaces; usertax reads the
`workspaces` field of the root `package.json` and supports `dir` and `dir/*` patterns. Bun
lockfiles are not supported yet.

Alternatives are shown for packages that were added or grew, only when the
[e18e module-replacements](https://github.com/e18e/module-replacements) dataset has an entry for
them. The data is generated into `packages/core/src/data/alternatives.json` by
`node scripts/update-alternatives.js`, and CI checks that it matches the pinned dataset version.

## Trying it locally

```bash
pnpm build
pnpm --filter @usertax-examples/vite-app build
node packages/cli/bin/usertax.js measure examples/vite-app --output head.json
node packages/cli/bin/usertax.js diff head.json --base base.json
node packages/cli/bin/usertax.js diff head.json --base base.json --format json --compression brotli
```
