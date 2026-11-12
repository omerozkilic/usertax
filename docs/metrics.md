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
| `route[<route>].css.{raw,gzip,brotli}`             | Stylesheets loaded for one route; only for routes that load at least one CSS file                                      | bytes    |
| `route[<route>].images.bytes`                      | Images a route's HTML, stylesheets or (Vite) code reference, file size; only for routes that reference one             | bytes    |
| `route[<route>].fonts.bytes`                       | Web fonts a route's stylesheets or HTML reference, file size; only for routes that reference one                       | bytes    |
| `bundle[<ios\|android>].raw`                       | React Native JS or Hermes bundle                                                                                       | bytes    |
| `package[<name>].bytes`                            | Minified bytes of one package in a web app's JavaScript, from source maps                                              | bytes    |
| `package[<name>][<ios\|android>].bytes`            | Minified bytes of one package in a React Native bundle                                                                 | bytes    |
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
    { "metric": "route[*].css.gzip", "max": "20 kB" },
    { "metric": "package[*].bytes", "maxIncrease": "20 kB" },
    { "metric": "package[lodash].bytes", "maxIncrease": 0 },
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
- Package budgets use the minified bytes of the package table (ADR 0008); compressed sizes per
  package do not add up and have no metric. `package[*].bytes` also matches the per-platform ids
  of mobile bundles. A package that is in only one of the two builds has 0 bytes in the other,
  so `"maxIncrease": "20 kB"` catches a new package too, as long as that build's bundle was
  attributed from source maps (otherwise the check is skipped). Package metrics are only used by
  budgets; the comment shows packages in their own table.
- When more than 20 checks match, the comment lists only the ones that fail or warn and counts
  the rest.
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
- A route's CSS is the stylesheets it loads initially, from the same source as its JavaScript:
  the `css` of each chunk in the Vite and React Router manifests, `<link rel="stylesheet">` in
  prerendered HTML, and `entryCSSFiles` in the Next.js client reference manifest. Routes that
  load no CSS file have no `route[<route>].css.*` metrics, so a route that stops loading CSS
  shows as removed. Stylesheets inlined into the HTML (`<style>`, such as the small stylesheets
  Astro inlines or Next.js `inlined` entries) are part of the HTML file's size, not of the route's
  CSS.
- A route's images and fonts are the files in the build output that it references, counted once
  each at their file size (they are compressed formats already):
  - from its stylesheets: the first source of each `@font-face` rule (a browser downloads the
    first format it supports; later ones are fallbacks) and every other `url()`;
  - from its prerendered HTML: `<img src>` (for responsive images the `src` fallback, or the
    first `srcset` candidate without one; the `<source>` alternatives of a `<picture>` are not
    counted), `<video poster>`, icons, `<link rel="preload">` of images and fonts, and `url()` in
    inline `<style>` blocks;
  - for Vite, also the images the route's code imports (the `assets` of its chunks in the
    manifest).

  These are the files a route _can_ load, an upper bound: a browser downloads a font only when
  text uses it, and only the `unicode-range` subsets it needs (`@fontsource/inter` declares
  seven), and a background image only when its selector matches. Images created at run time,
  `style` attributes, other hosts and `data:` URLs are not counted, nor are images that
  `next/image` optimises per request (they are not in the build output).

- For Astro (`dist/`), SvelteKit with adapter-static (`build/`) and Nuxt (`.output/public/`),
  routes come from the prerendered HTML of each page: the scripts, stylesheets and module preloads it references,
  Astro's `component-url` and `renderer-url` island attributes, the `import("…")` calls of
  SvelteKit's inline bootstrap, and the modules those files import statically. Dynamic
  `import()` calls are not followed, so they are not part of a route. `index.html` → `/`,
  `about/index.html` → `/about/`, `about.html` → `/about`.
  - Inline scripts are part of the HTML file, not of a route's JavaScript: Astro inlines small
    page scripts and the island runtime, SvelteKit its bootstrap. They are measured as part of
    the HTML file's size.
  - Source maps are needed for packages: set `vite.build.sourcemap` to `'hidden'` in
    `astro.config`, `build.sourcemap` to `'hidden'` in SvelteKit's `vite.config`, or
    `sourcemap: { client: 'hidden' }` in `nuxt.config`, or `build.sourcemap` to `'hidden'` in the
    `vite.config` of a React Router app.
  - Prefetch links (Nuxt prefetches the chunks of other pages) and data attributes are not
    loaded with the page and are ignored. `200.html` and `404.html`, the fallback pages of static
    hosts, are measured as files but are not routes.
  - A file whose whole name is a hash (Nuxt's `_nuxt/<hash>.js`, SvelteKit's
    `chunks/<hash>.js`) has no stable part to match between two builds, so a changed one shows as
    one file removed and one added. The totals per route and the per-package bytes do not depend
    on file names.
  - Nuxt writes its client files and the pages it prerendered to `.output/public` for both
    `nuxt generate` and `nuxt build`; pages that are not prerendered have no HTML to read.
  - SvelteKit without adapter-static writes its client output to `.svelte-kit/output/client`,
    which usertax uses when there is no `build/` directory. It has no prerendered pages, so
    there are no routes.
- For React Router 7 in framework mode (`build/client/`), routes come from the client manifest
  of the build, `assets/manifest-<hash>.js`, which lists every route with the modules it loads:
  the entry, and the module and static imports of each route from the root down to the page. A
  route with child routes is a layout, so a page is a route without children; an index route
  takes the path of its parent (`/`, `/about`, `/blog/:slug`, `/files/*`). It needs no HTML, so
  server-rendered apps, whose `build/client` has none, get routes too. Without a manifest, the
  prerendered pages are read like Astro's. `__spa-fallback.html` is not a route.
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
- For Rsbuild and Rspack (`dist/`), routes come from the HTML page of each entry
  (`index.html` → `/`, `about.html` → `/about`), read like Astro's; a build without HTML pages
  has files but no routes. Source maps are needed for packages: set `output.sourceMap` to
  `{ js: 'hidden-source-map' }` in `rsbuild.config`, or `devtool: 'hidden-source-map'` for
  Rspack. Rsbuild's 10-character content hashes (`static/js/index.[hash].js`) are replaced in
  keys like Vite's, and Rspack's runtime (`webpack://webpack/runtime/…`) is shown as `(virtual)`.

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
- **Browser extensions.** Lighthouse attributes an extension's requests and scripts to the page,
  so a run in a Chrome profile with extensions (a wallet's script is reported as unused
  JavaScript of the page, an ad blocker adds its own) measures the extensions as much as the
  app. usertax's own runner starts Chrome with a temporary profile and extensions disabled, so
  its runs are not affected; this check guards results that come from elsewhere, such as a
  Lighthouse result passed to `runFromResult` from a script that audits in a normal browser
  profile. When the requests or scripts that Lighthouse lists (`network-requests`, `bootup-time`,
  `unused-javascript`, `unminified-javascript`) include a `chrome-extension://`,
  `moz-extension://` or `safari-web-extension://` URL, the run records `contamination` (the
  extension origins and the number of distinct URLs). The comment then marks that page's
  Lighthouse metrics ⚠️ and "not comparable", gives no better or worse verdict for them, warns
  with the extension ids, and budgets on them are skipped. A skipped budget is not counted as a
  pass in the summary line.

## Why a package changed

When both reports carry a dependency snapshot (`usertax measure` reads the nearest
`pnpm-lock.yaml`, `package-lock.json` / `npm-shrinkwrap.json` or `yarn.lock`), each package in
the comment gets a reason:

| Reason                                         | Meaning                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `added 2.30.1 (direct)`                        | The app now declares the package.                                                     |
| `added 1.2.0 via x`                            | A transitive dependency, pulled in by the direct dependency or workspace package `x`. |
| `added 1.2.0 via x → y`                        | The same, more than one step away: `x` needs `y`, which needs the package.            |
| `upgraded 4.17.20 → 4.17.21`                   | One resolved version on each side.                                                    |
| `versions a → a, b`                            | Several versions are installed (duplicates).                                          |
| `removed …`                                    | No longer in the lockfile.                                                            |
| `same version; more or less of it is imported` | The lockfile did not change for this package; the app imports a different part of it. |

The chain is the shortest path in the lockfile from a direct dependency down to the package
that needs this one (the package itself is the row), taken from every lockfile format usertax
reads. When several chains have the same length, the first by package name is shown. It is left
out when `via` already says it (the package is one step from a direct dependency), when a
version of the package is closer than any chain, and for chains longer than ten packages. The
report keeps it as `dependencies[].chain`.

Lockfile changes that do not change any bundle (dev tooling, packages that are not bundled) are
listed separately in a collapsed section.

Supported lockfiles: pnpm 6.x and 9.x, npm lockfile versions 2 and 3, Yarn 1, Yarn 2+ and Bun's
text lockfile (`bun.lock`).
Workspace links are followed, so a dependency of a workspace package used by the app is reported
as coming "via" that package. Yarn 1 lockfiles do not record workspaces; usertax reads the
`workspaces` field of the root `package.json` and supports `dir` and `dir/*` patterns. Bun's
binary `bun.lockb` cannot be read: run `bun install --save-text-lockfile` once to write
`bun.lock`, the default since Bun 1.2.

Alternatives are shown for packages that were added or grew, only when the
[e18e module-replacements](https://github.com/e18e/module-replacements) dataset has an entry for
them. The data is generated into `packages/core/src/data/alternatives.json` by
`node scripts/update-alternatives.js`, and CI checks that it matches the pinned dataset version.

## Duplicate packages

When one JavaScript file contains the same package in more than one version, every user downloads
it more than once. usertax reports these from the source map, per installed copy:

- The copy is the directory where the bundler found the package (`node_modules/a/node_modules/x`,
  a copy hoisted above the app, or a folder in pnpm's virtual store). Its version comes from the
  pnpm folder name, or from the copy's `package.json` for npm, Yarn and Bun layouts.
- A report file lists `packages[].versions` (bytes per version) only when it holds at least two
  versions of the package. A copy whose `package.json` cannot be read has no version and is left
  out of the split, so the versions may add up to less than the package's total.
- The comment shows each duplicate with its versions, their minified bytes and, from the lockfile
  snapshot, the direct dependency that pulls each version in (`via`). Duplicates that the pull
  request introduced are marked **new**; when the base already had them they are collapsed.

Limits: a duplicate is detected inside one file. Two different versions in two different chunks
are not reported, and neither is the same version installed twice. Compressed sizes do not split
per version; the bytes are minified bytes, like the package list.

## Trying it locally

```bash
pnpm build
pnpm --filter @usertax-examples/vite-app build
node packages/cli/bin/usertax.js measure examples/vite-app --output head.json
node packages/cli/bin/usertax.js diff head.json --base base.json
node packages/cli/bin/usertax.js diff head.json --base base.json --format json --compression brotli
```
