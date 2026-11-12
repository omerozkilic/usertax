# Contributing to usertax

Thanks for your interest! usertax is in early development; issues and discussions are welcome.

## Setup

Requirements: Node.js 22.23.4 / 24.22.1 / 26.12.1 or newer (24 recommended, see `.nvmrc`) and pnpm 10
(`corepack enable` installs the version pinned in `package.json`).

```bash
pnpm install
pnpm check
```

| Command                             | What it does                                           |
| ----------------------------------- | ------------------------------------------------------ |
| `pnpm build`                        | Builds all packages with `tsc -b`                      |
| `pnpm typecheck`                    | Builds packages and type-checks tests and config files |
| `pnpm lint`                         | ESLint with type-aware rules                           |
| `pnpm format` / `pnpm format:check` | Prettier                                               |
| `pnpm test` / `pnpm test:coverage`  | Vitest; CI enforces coverage thresholds                |
| `pnpm check`                        | Everything CI runs                                     |
| `uvx zizmor .`                      | Lint the GitHub workflows like CI does (needs `uv`)    |

## Repository layout

- `packages/core`: pure logic (schema, diff, attribution, budgets, rendering). No I/O.
- `packages/measure`: collectors that read files and run tools.
- `packages/cli`: the `usertax` command.
- `docs/adr`: architecture decisions. Read them before changing a design.

## Pull requests

- One topic per PR. Keep `pnpm check` green.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat: …`, `fix: …`, `docs: …`, `chore: …`); PRs are squash-merged.
- New behaviour comes with tests. Parsers come with fixtures from real files.
- A change to a recorded decision updates or supersedes its ADR.

## Numbers and claims

Every number in documentation must come from a measurement in this repository that others can
reproduce, with the command used. No estimated or illustrative numbers presented as results.
Alternative-package suggestions must cite a source in `data/alternatives.json`.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
