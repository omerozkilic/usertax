# 0015. The MCP server is a command of the CLI

- Status: Accepted
- Date: 2026-11-04

## Context

ADR 0002 planned a separate `packages/mcp` for an MCP server, so that coding agents can ask
"what does this change cost users?" and get usertax's numbers instead of guessing. The CLI is
already published as one bundled npm package (`npx usertax`, ADR 0011), and every tool the
server needs (measure, diff, the alternatives data) is in the CLI.

## Decision

- The server is `usertax mcp`, a command of the CLI (`packages/cli/src/mcp.ts`), using the
  official MCP TypeScript SDK over stdio. One npm package and one binary serve people, CI and
  agents; MCP clients start it with `npx -y usertax mcp`.
- Tools: `measure` (built apps → a saved report and its head values), `compare` (the same output
  as `usertax diff`, budgets included), `explain_package` (bytes per file, lockfile versions and
  `via`, base comparison, alternatives) and `alternatives` (the curated dataset only).
- The tools run the CLI's own commands and core functions, so an agent sees exactly the numbers
  the CLI and the PR comment show. The server instructions tell the agent not to estimate.
- Tools read local files only; `measure` writes one report file. Nothing calls a network service
  or a language model (ADR 0013): the AI is the client, outside usertax. Lighthouse is not
  offered, because a run takes minutes; agents can run `usertax measure --lighthouse` instead.
- Tool failures (missing files, invalid reports) are returned as tool errors with the CLI's
  message, so the agent can correct the call.

## Consequences

- No separate package to version and publish; the MCP SDK adds about 0.6 MB to the bundled CLI.
- The action bundle, which runs the CLI's `main`, contains the server code too, unused.
- ADR 0002's `packages/mcp` row is replaced by this record.

## Alternatives considered

- A separate `@usertax/mcp` package: a second package and binary for the same code.
- A hand-written JSON-RPC server: fewer bytes, but the protocol (version negotiation,
  capabilities, schemas) is better served by the official SDK.
