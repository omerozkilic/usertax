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
