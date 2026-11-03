# Configuration

usertax works without configuration and reads `usertax.config.json` (or `.ts`, `.mjs`, `.js`
with a default export) at the repository root when you need more. The JSON Schema is published
as [`@usertax/core/schema/config.schema.json`](../packages/core/schema/config.schema.json);
point `$schema` at it for completion in your editor.

## Without configuration

`usertax measure` (without an app directory) finds the apps of the repository:

1. the packages listed in `pnpm-workspace.yaml`, or in the `workspaces` field of the root
   `package.json` (npm, Yarn), with `dir`, `dir/*` and `dir/**` patterns;
2. or the root package of a single-package repository.

A package is measured when its dependencies name a supported framework: Vite, Next.js, webpack
or Expo. Bare React Native apps are skipped with a message, because usertax needs to know which
bundles or archives to read. Every app must already be built.

## Example

```json
{
  "$schema": "./node_modules/@usertax/core/schema/config.schema.json",
  "apps": [
    { "path": "apps/web", "lighthouse": { "pages": ["/", "/pricing"], "runs": 5 } },
    { "path": "apps/docs", "id": "docs", "outDir": "build" },
    {
      "path": "apps/mobile",
      "framework": "react-native",
      "bundles": [
        { "platform": "android", "file": "dist/index.android.bundle" },
        { "platform": "ios", "file": "dist/main.jsbundle" }
      ],
      "archives": [{ "file": "android/app/build/outputs/apk/release/app-release.apk" }]
    }
  ],
  "budgets": [
    { "app": "web", "metric": "route[*].js.gzip", "maxIncrease": "10 kB" },
    { "metric": "archive[*].file", "maxIncreasePercent": 2, "level": "warn" }
  ],
  "compression": "gzip",
  "top": 10
}
```

| Field               | Meaning                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps`              | Apps to measure. Without it, usertax discovers them (above).                                                                     |
| `apps[].path`       | App directory relative to the repository root. Required.                                                                         |
| `apps[].id`, `name` | Identity in reports and comments. Default: the package name.                                                                     |
| `apps[].framework`  | `vite`, `next`, `webpack`, `static`, `expo`, `react-native`. Default: detected.                                                  |
| `apps[].outDir`     | Build output, relative to the app. Default: `dist` (`.next` for Next.js).                                                        |
| `apps[].bundles`    | React Native bundles (`platform`, `file`, optional `map`), relative to the app. Expo apps default to their `expo export` output. |
| `apps[].archives`   | APK, AAB or IPA files (`file`, optional `key`), relative to the app.                                                             |
| `apps[].lighthouse` | `pages` (paths), `runs` (default 5), `formFactor` (`mobile` or `desktop`), and optionally `baseUrl` with `startCommand`.         |
| `budgets`           | See [metrics and budgets](metrics.md#budgets).                                                                                   |
| `noise`             | Lighthouse noise thresholds per metric (`performance`, `lcp`, `tbt`, `cls`): `{ "floor": …, "k": … }`. See ADR 0007.             |
| `compression`       | Size shown for web assets in comments: `gzip` (default), `brotli` or `raw`.                                                      |
| `top`               | Files, packages and archive entries listed per app (default 10).                                                                 |

Unknown keys are errors, so typos do not pass silently.

## Commands

```bash
usertax measure --output head.json            # all apps of the repository
usertax measure apps/web --output web.json    # one app; its configuration entry supplies defaults
usertax diff head.json --base base.json       # budgets from the configuration; exit code 1 if one fails
usertax diff head.json --config ci/usertax.json
```
