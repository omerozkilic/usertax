# usertax

**What does this pull request cost your users?**

usertax measures the user-facing cost of every pull request, for **web** and **mobile**
(React Native, Expo and bare), and explains _why_ it changed: which dependency was added or
upgraded, and which modules grew.

> **Status: early development.** Nothing is released yet and there are no published numbers.
> Every number that appears in this README will come from the apps in `examples/`,
> with instructions to reproduce it.

[Türkçe özet](README.tr.md)

## What it will report

One sticky comment per pull request, plus a job summary, a check status and a JSON report:

- **Web:** Lighthouse performance score and lab metrics (LCP, TBT, CLS) as the median of
  several runs with their spread, JavaScript per route (gzip and brotli), base → head.
- **Mobile:** iOS and Android JS / Hermes bundle size, APK / AAB / IPA size with a breakdown
  (JS bundle, native libraries, dex, resources, assets).
- **Why:** the lockfile diff of the PR joined with source-map module sizes, e.g. a newly added
  date library and how many bytes it brought in, with an alternative from a curated list where
  every entry cites its source.
- **Budgets:** warn / fail thresholds, GitHub check status, machine-readable JSON.

## Principles

1. **Deterministic, no API keys.** No LLM in the measuring and diffing path.
2. **Honest numbers.** Lighthouse noise is measured and shown; changes below the noise
   threshold are reported as "no significant change".
3. **Zero config, configurable.** Detects Vite, Next.js, webpack, Expo and bare React Native;
   `usertax.config.(json|ts)` for budgets and paths.
4. **The action does not build your mobile app.** Point it at the APK / AAB / IPA you already
   build. IPA analysis runs on Linux.
5. **Safe for fork PRs.** Measure in `pull_request`, comment in `workflow_run`; minimal
   permissions; no secrets.
6. **Fast.** Base reports are stored as artifacts on the default branch and reused in PRs.
7. **Monorepos.** Several apps, one comment.

Design decisions are recorded in [`docs/adr/`](docs/adr/). Metric ids, budgets and the noise
model are described in [`docs/metrics.md`](docs/metrics.md).

## Roadmap

| Milestone | Scope                                                       | Status      |
| --------- | ----------------------------------------------------------- | ----------- |
| M0        | Repository scaffold, CI, ADRs                               | In progress |
| M1        | Report schema, diff, budgets, rendering                     | Planned     |
| M2        | Web bundles: Vite, source-map module and package sizes      | Planned     |
| M3        | Attribution: lockfile diffs, curated alternatives           | Planned     |
| M4        | Next.js, Lighthouse with a measured noise model             | Planned     |
| M5        | Mobile: Expo and bare React Native bundles, APK / AAB / IPA | Planned     |
| M6        | GitHub Action and CLI, fork-safe workflows, monorepos       | Planned     |
| M7        | Documentation with measured examples, release               | Planned     |
| M8        | MCP server for coding agents                                | Later       |

## Prior art

usertax builds on ideas from these projects; if you need only one of their features today,
use them:

- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) and
  [treosh/lighthouse-ci-action](https://github.com/treosh/lighthouse-ci-action)
- [size-limit](https://github.com/ai/size-limit),
  [compressed-size-action](https://github.com/preactjs/compressed-size-action),
  [BundleMon](https://github.com/LironEr/bundlemon),
  [RelativeCI bundle-stats](https://github.com/relative-ci/bundle-stats)
- [rn-size-check](https://github.com/MuhammadHamza47/rn-size-check),
  [app-size-report](https://github.com/appshipkit/app-size-report),
  [react-native-agents `size`](https://github.com/maheshwarimrinal/react-native-agents),
  [Expo Atlas](https://github.com/expo/atlas),
  [react-native-bundle-visualizer](https://github.com/callstack/react-native-bundle-visualizer)
- [e18e module-replacements](https://github.com/e18e/module-replacements) (data source for
  alternatives)

See [`docs/research/2026-11-market-scan.md`](docs/research/2026-11-market-scan.md) for a
comparison.

## Development

```bash
pnpm install
pnpm check   # lint, format check, typecheck, tests with coverage
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
