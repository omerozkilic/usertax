# 0014. Missing base reports are recreated by the measure workflow, not by the action

- Status: Accepted
- Date: 2026-11-04

## Context

ADR 0004 item 4 planned that, when no base report exists for the merge base or its ancestors,
the action measures the base itself in a separate git worktree. Measuring needs a built app,
and usertax never builds (ADR 0012: the user's workflow builds; `usertax measure` reads the
output). Building the base inside the action would mean knowing every repository's install and
build commands, running them twice per pull request, and, in the comment workflow, building code
in a job that holds a write token.

## Decision

- The action does not build or measure the base.
- A base report is stored by every measure run on the default branch: `push` as before, and
  also `workflow_dispatch` and `schedule`, so a maintainer can recreate a missing or expired
  base report by running the measure workflow on the default branch.
- When no base is found, the comment shows head values, says that no base was found, and says
  how to get one (run the measure workflow on the default branch, then update the pull request
  branch so that its merge base has a report).
- This supersedes item 4 of ADR 0004; the rest of ADR 0004 stands.

## Consequences

- One build per pull request, as before; no build commands in the action's configuration.
- A pull request whose merge base has no report and no reported ancestor within 20 commits gets
  head values only until its branch is updated.
- Repositories that want a comparison always can still build the base themselves in their
  workflow and pass both reports to `usertax diff`.

## Alternatives considered

- Build the base in a worktree from configured commands: doubles CI time, and every build
  system needs its own configuration.
- Build the base in the comment workflow: runs a build in the job that holds the write token.
