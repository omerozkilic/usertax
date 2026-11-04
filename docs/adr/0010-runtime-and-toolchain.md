# 0010. Runtime and toolchain

- Status: Accepted
- Date: 2026-11-03

## Context

GitHub-hosted runners default to Node 24 since 2026-06-16 and removed Node 20 on 2026-09-23.
The CLI also runs on developers' machines.

## Decision

- The action uses `runs.using: node24`. The CLI supports Node `>=22.18.0` (active LTS lines;
  22.18 is the first 22.x with TypeScript type stripping on by default, used for
  `usertax.config.ts`, see ADR 0012).
- ESM only. TypeScript in strict mode with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- TypeScript 6.0. TypeScript 7 (native) is released, but typescript-eslint 8.72 supports
  `typescript <6.1`; we move when typed linting supports it.
- Packages build with `tsc -b` (project references). The action is bundled into a single
  `dist/index.js` (bundler chosen in milestone 6) that is committed only to the thin action
  repository (ADR 0006).
- Tests: Vitest with V8 coverage; CI enforces 90 % lines/functions/statements and 85 % branches.
- Lint: ESLint flat config with typescript-eslint `strictTypeChecked` and
  `stylisticTypeChecked`; formatting with Prettier.
- pnpm workspaces; versions of third-party GitHub Actions are pinned by commit SHA.

## Implementation notes (milestone 6)

- The action is bundled with esbuild into `packages/action/dist/index.js` (ESM, Node 22 target,
  about 1.3 MB). `lighthouse` and `chrome-launcher` stay external and are resolved from the
  measured repository at run time. The bundle is built in CI and by the dogfooding workflows; it
  is committed only to the thin action repository at release time (ADR 0006).

## Implementation notes (Node.js security releases, October 2026)

- The supported range is `^22.23.4 || ^24.22.1 || >=26.12.1`: the first releases of each line
  that fix CVE-2026-111497 (Brotli decoder out-of-bounds write, in CISA's Known Exploited
  Vulnerabilities catalog), CVE-2026-105483 and CVE-2026-106069 (TLS hostname validation) and
  CVE-2026-105482 (DNS). The action talks to the GitHub API over TLS, and Node's `fetch` decompresses
  Brotli-encoded responses, so older runtimes are not supported. The CLI warns at start-up on an older
  runtime; the action runs on the runner's `node24`, which GitHub updates.

## Consequences

- Modern runtime APIs (`zlib` brotli, `parseArgs`, type stripping) without polyfills.
- Users on Node 20 cannot run the CLI; Node 20 reached end of life in April 2026.

## Alternatives considered

- TypeScript 7 now: no typed linting.
- tsup/tsdown for packages: unnecessary for libraries that `tsc` emits directly.
