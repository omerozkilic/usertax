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

## Consequences

- Modern runtime APIs (`zlib` brotli, `parseArgs`, type stripping) without polyfills.
- Users on Node 20 cannot run the CLI; Node 20 reached end of life in April 2026.

## Alternatives considered

- TypeScript 7 now: no typed linting.
- tsup/tsdown for packages: unnecessary for libraries that `tsc` emits directly.
