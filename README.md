<div align="center">

# usertax

**What does this pull request cost your users?**<br>
Web and mobile · Explains _why_ · No API keys

[![CI](https://github.com/omerozkilic/usertax/actions/workflows/ci.yml/badge.svg)](https://github.com/omerozkilic/usertax/actions/workflows/ci.yml)
[![CodeQL](https://github.com/omerozkilic/usertax/actions/workflows/codeql.yml/badge.svg)](https://github.com/omerozkilic/usertax/actions/workflows/codeql.yml)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.18-339933)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.base.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[Türkçe README](README.tr.md) · [Metrics & budgets](docs/metrics.md) · [Architecture decisions](docs/adr/README.md) · [Demo](docs/demo/README.md)

</div>

---

usertax measures what a pull request costs the people who use your app — JavaScript shipped per
route, Lighthouse lab metrics, React Native bundles and APK / AAB / IPA size — and answers the
question reviewers actually ask: **why did it change?** It joins the lockfile diff of the PR with
source-map sizes, so a comment says _"`moment` was added and brought 60 kB"_ instead of _"the
bundle grew"_.

It is deterministic: **no LLM, no API key, no account, no upload.** The same build gives the
same report.

> [!NOTE]
> usertax is in active development and not released yet. Web bundles (Vite, Next.js), React
> Native and Expo bundles, APK / AAB / IPA analysis, attribution, Lighthouse runs, the CLI and the
> GitHub Action work in this repository (see [Status](#status)).

## What it looks like

A real pull request against [`examples/vite-app`](examples/vite-app) that adds `moment` to show
a date. This is usertax's output, measured on real builds
([full comment](docs/demo/add-moment.md), [how to reproduce](docs/demo/README.md)):

> |     | Metric                |    Base |    Head |            Change |
> | :-: | --------------------- | ------: | ------: | ----------------: |
> | 🔴  | JS total (gzip)       | 69.4 kB | 89.0 kB | +19.6 kB (+28.2%) |
> | 🔴  | JS for / (gzip)       | 68.9 kB | 88.5 kB | +19.6 kB (+28.4%) |
> | 🔴  | JS for /about/ (gzip) | 67.9 kB | 68.1 kB |    +169 B (+0.2%) |
>
> **Packages with the largest change** <sub>minified bytes from source maps</sub>
>
> | Package            | Bundle |   Base |    Head |   Change | Why                     |
> | ------------------ | ------ | -----: | ------: | -------: | ----------------------- |
> | `moment`           | web    |      – | 60.1 kB | +60.1 kB | added `2.30.1` (direct) |
> | _first-party code_ | web    | 1.3 kB |  1.3 kB |    +64 B | –                       |
>
> **Alternatives** suggested by [e18e module-replacements](https://github.com/e18e/module-replacements) 3.4.0:
>
> - `moment`: day.js, date-fns, luxon, Date, Temporal ([guide](https://e18e.dev/docs/replacements/moment))

## Why usertax?

- **Explains the change.** Lockfile diffs (pnpm, npm, Yarn 1 and Yarn 2+) are joined with
  byte-exact source-map attribution: added, upgraded, or "same version, more of it imported" —
  including transitive packages and the dependency that pulled them in
  ([ADR 0008](docs/adr/0008-attribution-lockfile-and-source-maps.md)).
- **Honest numbers.** Every byte of every JavaScript file is attributed to a package, to your
  code, or explicitly to "unattributed", and the three add up to the file size. Lighthouse
  changes are judged against measured noise, never guessed
  ([ADR 0007](docs/adr/0007-lighthouse-noise-model.md)).
- **Sourced suggestions only.** Alternatives come from the curated, MIT-licensed
  [e18e module-replacements](https://github.com/e18e/module-replacements) dataset, with a link
  to its guide. Nothing is generated.
- **Web and mobile in one comment.** The report format covers routes, React Native bundles and
  app archives for any number of apps, so one PR comment is designed to cover a whole monorepo
  ([ADR 0003](docs/adr/0003-report-schema-as-public-contract.md)).
- **Safe for fork PRs by design.** Measure in `pull_request`, comment from `workflow_run`;
  reports from PRs are validated and escaped as untrusted input
  ([ADR 0005](docs/adr/0005-fork-safe-two-workflow-pattern.md)).
- **Fast.** Base reports are stored once per push to the default branch and reused by every PR
  ([ADR 0004](docs/adr/0004-base-reports-from-artifacts.md)).

## Status

| Area         | Today                                                                                                                                                   | Planned                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Web bundles  | Vite and Next.js 16 with Turbopack or webpack (routes), webpack and static output (files)                                                               | –                                             |
| Attribution  | Source maps, lockfiles: pnpm 6 / 9, npm 2 / 3, Yarn 1, Yarn 2+                                                                                          | Bun                                           |
| Budgets      | `max`, `min`, increase / decrease in bytes or percent, warn / fail, from `usertax.config.(json\|ts)`; exit code 1 on failure                            | –                                             |
| Lighthouse   | Runner (`--lighthouse`), every run stored, medians, IQR, noise thresholds calibrated on GitHub-hosted runners ([benchmarks](docs/benchmarks/README.md)) | –                                             |
| Mobile       | Expo and bare React Native bundles (JS and Hermes bytecode, with attribution), APK / AAB / IPA breakdown                                                | Per-device download estimates                 |
| Distribution | CLI from source; GitHub Action (fork-safe two-workflow setup, dogfooded in this repository); monorepos in one report                                    | Released action and `npx usertax`, MCP server |

## GitHub Action

Two workflows: one measures the pull request with a read-only token, the other posts the comment
from your default branch, so pull requests from forks are safe
([setup and inputs](docs/github-action.md)). This repository runs the action on its own pull
requests. It is not released yet.

## Quickstart (CLI)

usertax is not published yet; run the CLI from a clone:

```bash
git clone https://github.com/omerozkilic/usertax && cd usertax
pnpm install && pnpm build

# Measure an app you have already built (Vite: build.sourcemap = 'hidden', build.manifest = true)
node packages/cli/bin/usertax.js measure path/to/app --output base.json
# …make your change, rebuild…
node packages/cli/bin/usertax.js measure path/to/app --output head.json

node packages/cli/bin/usertax.js diff head.json --base base.json          # Markdown
node packages/cli/bin/usertax.js diff head.json --base base.json -f json  # JSON
```

`usertax measure` reads the build output, the source maps and the nearest lockfile. It never
builds your app and never needs network access.

## How it works

```text
 build output ─┐
 source maps ──┼─▶ usertax measure ─▶ report.json ─┐
 lockfile ─────┘   (@usertax/measure)              ├─▶ usertax diff ─▶ PR comment · job summary · JSON
                                     base report ──┘   (@usertax/core: diff, attribution,
                                                        budgets, noise model, rendering)
```

- [`@usertax/core`](packages/core): pure functions. Report schema, diff, attribution, budgets,
  Markdown and JSON rendering. No file system, no network.
- [`@usertax/measure`](packages/measure): collectors. Output directories, source maps,
  lockfiles.
- [`usertax`](packages/cli): the command-line interface.

Metric ids, units, budgets and the noise model are documented in
[`docs/metrics.md`](docs/metrics.md); the configuration file in
[`docs/configuration.md`](docs/configuration.md).

## Development

```bash
pnpm install
pnpm check            # typecheck, lint, format, tests with coverage
pnpm build:examples   # build the example apps
pnpm e2e              # measure the examples and check invariants
pnpm demo             # reproduce docs/demo/add-moment.md
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Every number in this repository's documentation comes
from a measurement you can reproduce with these commands.

## Prior art

usertax builds on ideas from these projects. If you need one of their features today, use them:
[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci),
[treosh/lighthouse-ci-action](https://github.com/treosh/lighthouse-ci-action),
[size-limit](https://github.com/ai/size-limit),
[compressed-size-action](https://github.com/preactjs/compressed-size-action),
[BundleMon](https://github.com/LironEr/bundlemon),
[RelativeCI bundle-stats](https://github.com/relative-ci/bundle-stats),
[rn-size-check](https://github.com/MuhammadHamza47/rn-size-check),
[app-size-report](https://github.com/appshipkit/app-size-report),
[react-native-agents `size`](https://github.com/maheshwarimrinal/react-native-agents),
[Expo Atlas](https://github.com/expo/atlas) and
[react-native-bundle-visualizer](https://github.com/callstack/react-native-bundle-visualizer).
A comparison is in [`docs/research/2026-11-market-scan.md`](docs/research/2026-11-market-scan.md).

## License

[MIT](LICENSE). Alternative-package data is generated from
[e18e module-replacements](https://github.com/e18e/module-replacements) (MIT).
