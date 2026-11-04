# CLAUDE.md

Guidance for Claude (and other coding agents) working in this repository.

## Communication

- Talk to the maintainer in **Turkish**.
- Code, comments, commit messages, PR titles/bodies, README and docs are in **English**.
  `README.tr.md` is a short Turkish summary; keep it in sync with major README changes.

## What usertax is

A GitHub Action and CLI (`npx usertax`) that reports, on every pull request, what the change
costs users on web (Lighthouse, JS per route) and mobile (React Native / Expo JS and Hermes
bundles, APK / AAB / IPA), and attributes the change to dependencies via lockfile diffs and
source maps. Read `docs/adr/` before changing a design; update or supersede an ADR when a
decision changes.

## Commands

```bash
pnpm install
pnpm check          # typecheck (builds) + lint + format:check + test:coverage (what CI runs)
pnpm test -u        # update Markdown snapshots in packages/*/test/__snapshots__/ (review the diff!)
pnpm --filter @usertax/core schema   # regenerate the report JSON Schema after `pnpm build`
pnpm test           # vitest
pnpm build          # tsc -b for all packages
pnpm build:examples # build the example apps in examples/
pnpm e2e            # measure the built examples with the CLI and check invariants
pnpm pack:cli       # build the npm package of the CLI into release/npm (see docs/releasing.md)
pnpm build:action   # bundle the GitHub Action into packages/action/dist
pnpm demo           # add moment to the Vite example in a worktree; regenerates docs/demo/add-moment.md with --output
node scripts/update-alternatives.js   # regenerate e18e alternatives after bumping module-replacements
node scripts/calibrate-lighthouse.js --runs 30   # Lighthouse noise on this machine (see docs/benchmarks)
```

Every milestone PR must leave `pnpm check` and `pnpm build` green.

## Layout and rules

- `packages/core`: pure functions only. No `node:fs`, no child processes, no network.
- `packages/measure`: collectors with I/O. Heavy tools (Lighthouse) are optional peers,
  imported lazily.
- `packages/cli`: the `usertax` binary and its MCP server (`usertax mcp`, ADR 0015). `main(argv, io)`
  returns an exit code; never call `process.exit` inside library code.
- ESM, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
  Relative imports use the `.js` extension.
- Tests live in `packages/*/test/` and import packages by name (`@usertax/core`); Vitest aliases
  them to sources. Use fixtures from real files for parsers (source maps, lockfiles, archives).
- Renderer output is covered by file snapshots (`__snapshots__/*.md`, excluded from Prettier);
  hostile-input tests render Markdown with a GFM parser and check the resulting HTML.
- Coverage thresholds are enforced (90 % lines/functions/statements, 85 % branches).
- Third-party GitHub Actions are pinned by commit SHA with the version in a comment.

## Non-negotiables

- **No invented numbers.** Every number in README, docs or examples comes from a reproducible
  measurement in this repository. Never write illustrative numbers as if measured.
- **No invented suggestions.** Alternative packages come only from `data/alternatives.json`,
  each with a `source`.
- **No LLM in the core** (ADR 0013).
- **Fork safety** (ADR 0005): never use `pull_request_target` to run PR code; treat reports
  from artifacts as untrusted input.
- Ask the maintainer before irreversible steps: creating repositories, tags, releases, npm or
  Marketplace publishing, making the repository public.

## Git

- Conventional Commits; PRs are squash-merged; one milestone per branch and PR.
