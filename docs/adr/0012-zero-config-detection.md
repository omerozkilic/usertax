# 0012. Zero-config detection and configuration file

- Status: Accepted
- Date: 2026-11-03

## Context

Adoption depends on a one-line setup. Real projects are monorepos with several apps, custom
output folders and their own budgets.

## Decision

- **Workspace discovery.** Read `pnpm-workspace.yaml` or the `workspaces` field of
  `package.json` (npm, Yarn). Every workspace package and the root are candidate apps.
- **App detection** from dependencies and config files:
  - Next.js: `next` dependency or `next.config.*`.
  - Vite: `vite` dependency or `vite.config.*`.
  - webpack: `webpack` dependency or `webpack.config.*`.
  - Expo: `expo` dependency.
  - Bare React Native: `react-native` dependency without `expo`.
    Packages that match nothing (libraries) are skipped.
- **Configuration** in `usertax.config.json` (with a published JSON Schema) or
  `usertax.config.ts` (loaded with Node's built-in type stripping, no extra dependency) at the
  repository root: apps to include or exclude, output paths, Lighthouse URLs or start commands,
  mobile artifact paths and budgets. Action inputs override the file for one-off settings.
- Detection results are printed so users can see what was measured and why.

## Implementation notes (milestone 6)

- `usertax measure` without an app directory measures the configured apps, or else the
  discovered workspace apps, into one report. Workspace patterns `dir`, `dir/*` and `dir/**`
  (four levels) are supported; `node_modules` and dot-directories are skipped.
- Bare React Native apps are not measured without configuration, because their bundles have no
  conventional location.
- The configuration schema is strict (unknown keys are errors) and published as JSON Schema.
- `usertax diff` reads budgets, noise thresholds, compression and `top` from the configuration
  and exits with code 1 when a budget fails.

## Consequences

- One line works for common layouts; unusual ones need a short config.
- Detection rules need fixtures per framework version.

## Alternatives considered

- Config required: higher setup cost, fewer users try it.
