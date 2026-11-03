# 0002. Package boundaries: core, measure, cli, action

- Status: Accepted
- Date: 2026-11-03

## Context

usertax measures very different things (static bundles, Lighthouse runs in Chrome, React
Native bundles, APK/AAB/IPA archives), compares them and renders the result for several
consumers: a PR comment, a job summary, JSON, the CLI and, later, an MCP server. Measuring
needs the file system, child processes and heavy dependencies; comparing and rendering do not.

## Decision

A pnpm workspace with these packages:

| Package                         | Responsibility                                                                                                                     | May do I/O?                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@usertax/core`                 | Report schema, diff, attribution (joining lockfile and source-map data), budgets, rendering (Markdown, job summary, JSON)          | No. Pure functions over data. |
| `@usertax/measure`              | Collectors: web bundles and framework adapters, Lighthouse, React Native bundles, mobile archives, lockfile and source-map readers | Yes                           |
| `usertax` (`packages/cli`)      | The `usertax` command: `measure`, `diff`, `report`                                                                                 | Yes                           |
| `packages/action` (milestone 6) | GitHub Action entry point, bundled to a single `dist/` file                                                                        | Yes, plus the GitHub API      |
| `packages/mcp` (later)          | MCP server for coding agents                                                                                                       | Yes                           |

Heavy dependencies such as Lighthouse are optional peer dependencies of `@usertax/measure`,
loaded only when the corresponding collector runs.

## Consequences

- `core` is fast to test with fixtures and has no platform-specific behaviour.
- The CLI, the action and the MCP server share one implementation of diffing and rendering, so
  their numbers cannot drift apart.
- Package boundaries add some ceremony (project references, exports maps).

## Alternatives considered

- A single package: simpler at first, but the action bundle and the CLI would pull in every
  collector, and the pure logic would be harder to keep pure.
- One package per collector: too fine-grained for the current size; can be split later.
