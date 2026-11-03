# 0003. The report JSON schema is the public contract

- Status: Accepted
- Date: 2026-11-03

## Context

The same report data crosses several boundaries: base reports stored as artifacts on `main`
(ADR 0004), the artifact handed from the untrusted measuring workflow to the commenting
workflow (ADR 0005), JSON output consumed by other tools, and the future MCP server.

## Decision

- Reports and diffs are JSON documents described by a schema defined once in `@usertax/core`
  (zod), from which a JSON Schema file is generated and published.
- Every document carries an integer `schemaVersion`. Additive, optional fields do not change
  it; removing or changing the meaning of a field does, and readers reject unknown major
  versions with a clear message.
- A report records how it was produced: tool version, git SHA, compression settings,
  Lighthouse settings and runner environment, so a number can always be traced and reproduced.
- A report also records a snapshot of resolved dependencies (name and version per app), so
  attribution against a cached base does not need the base lockfile from git.
- Every document read from outside the process is validated against the schema before use.

## Consequences

- Validation doubles as the security boundary for artifacts produced by untrusted code.
- Schema changes need care and a changelog entry; this is intended.

## Alternatives considered

- Ad-hoc TypeScript types only: no runtime validation, no contract for other tools.
