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
  - Astro: `astro` dependency; SvelteKit: `@sveltejs/kit` dependency; Nuxt: `nuxt` dependency;
    React Router framework mode: `@react-router/dev` dependency (`react-router` alone is the
    library, a Vite app with a router). All build with Vite and depend on it, so they are checked
    before Vite.
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

## Implementation notes (Astro, SvelteKit, Nuxt and React Router)

- Neither framework writes a Vite manifest of its own, so routes are read from the prerendered
  HTML, the same source of truth the browser has: the files a page references and the modules
  they import statically. The reader is deliberately small (attribute and statement patterns,
  not an HTML or JavaScript parser), bounded so that hostile build output cannot make it slow,
  and tested against real Astro 7 and SvelteKit 3 builds.
- SvelteKit 3 reads its configuration from the `sveltekit(...)` Vite plugin and rejects
  `svelte.config.js`, so detection looks at dependencies, not at configuration files.
- The default output directory is `dist` for Astro and `build` for SvelteKit (adapter-static
  writes the whole site there). When `build/` does not exist, SvelteKit's
  `.svelte-kit/output/client` is used: the assets are measured, but there are no pages to read
  routes from.

- Nuxt writes the client files and the prerendered pages to `.output/public`, for `nuxt generate`
  and `nuxt build` alike. The same reader serves it, with two lessons from the real build:
  `data-src` must not read as `src` (attribute names are matched whole), and `200.html` and
  `404.html` are host fallbacks, not routes.

- React Router 7 writes a client manifest next to its assets, for server-rendered and prerendered
  apps alike, so routes come from it and not from HTML: server-rendered apps (the default) have
  no HTML pages to read. The manifest is build output, so its shape is checked and a manifest
  that does not fit gives no routes (the prerendered pages are then tried). Verified on real
  React Router 7.18.5 builds in both modes and on a 8.5.1 build (prerendered), which writes the
  same manifest.

## Consequences

- One line works for common layouts; unusual ones need a short config.
- Detection rules need fixtures per framework version.

## Alternatives considered

- Config required: higher setup cost, fewer users try it.
