# Test fixtures

## `vite-dist/`

Real output of `pnpm --filter @usertax-examples/vite-app build` (Vite 8.3.5, React 19.3.1),
copied unchanged except that `sourcesContent` was removed from the source maps to keep the
fixture small. usertax does not read `sourcesContent`.

To refresh it, build the example and copy `examples/vite-app/dist/` here, then strip
`sourcesContent` from `assets/*.map`. Tests that depend on exact byte counts read them from the
files, so they keep working after a refresh.

## `lockfiles/`

The same small workspace (root depends on `ms`; `packages/web` depends on `react`, `react-dom`,
the workspace package `lib` and, as a dev dependency, `is-number`; `packages/lib` depends on
`moment`) installed with four package managers on 2026-11-03:

| Directory | Generated with |
| --- | --- |
| `pnpm/` | `pnpm install --lockfile-only` (pnpm 10.28.0, lockfile v9) |
| `npm/` | `npm install --package-lock-only` (npm 10.9.9, lockfile v3) |
| `yarn1/` | `yarn install` (Yarn 1.22.22, lockfile v1) |
| `berry/` | `yarn install --mode=update-lockfile` (Yarn 4.18.1, lockfile v10) |

Only the manifests and lockfiles are kept.

## `next-dist/`

Part of the real `.next/` output of `pnpm --filter @usertax-examples/next-app build` (Next.js
16.4.4 with Turbopack, React 19.3.1, `productionBrowserSourceMaps: true`): `BUILD_ID`,
`build-manifest.json`, `static/` (with `sourcesContent` removed from the maps), the prerendered
HTML pages and the client reference manifest of `/counter`.

## `next-webpack-dist/`

Part of the real `.next-webpack/` output of the same example built with
`pnpm --filter @usertax-examples/next-app run build:webpack` (Next.js 16.4.4 with webpack):
`BUILD_ID`, `build-manifest.json`, the prerendered HTML pages and the small chunks of `static/`
(`sourcesContent` removed from the maps). The four large shared chunks (`framework`, `main`,
`882`, `42cfba27`) and `polyfills` are left out to keep the fixture small, so routes list only
the files that are present.

## `lighthouse-vite.json`

A real Lighthouse 13.6.0 result for `/` of the built `examples/vite-app`, served by usertax's
static server, trimmed to the fields usertax reads plus a few for context. The requested URL is
replaced by its path because the port was random.

## `hermes/`

`index.android.hbc` is real Hermes bytecode compiled by `hermesc` (from the `hermes-compiler`
package that React Native 0.88 installs) from the two modules in `src/`. `build.mjs` reproduces
it: it concatenates the modules into a bundle, compiles it with `-output-source-map`, and
composes the resulting map with the bundle's map, as React Native's build does.

## `archives/`

ZIP archives with the real layouts of an APK, an AAB and an IPA (paths, stored vs deflated
entries), generated deterministically by `archives/generate.py` with Python's `zipfile` and
Info-ZIP's `zip` (`-fz` forces ZIP64 records in `zip64-ipa`; `commented` has an archive comment).
Entry contents are placeholders, except the JS bundles of the APK and IPA, which are the real
Hermes bytecode from `hermes/`. A real APK built from `examples/expo-app` is analysed in CI
(see the `android` job) because this environment has no Android SDK.
