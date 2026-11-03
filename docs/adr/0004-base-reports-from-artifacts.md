# 0004. Reuse base reports stored as workflow artifacts

- Status: Accepted
- Date: 2026-11-03

## Context

A diff needs a base. Rebuilding and re-measuring the base branch on every PR doubles CI time
and cost, and for mobile it would mean building the base app as well.

## Decision

1. On every push to the default branch, the workflow measures the head and uploads the report
   as an artifact named `usertax-base-<sha>`.
2. On a pull request, the action computes the merge base of the PR and looks up
   `usertax-base-<merge-base-sha>` through the Actions artifacts API (`actions: read`).
3. If it is missing (expired, or the run failed), the action walks up to 20 first-parent
   ancestors of the merge base and uses the nearest one that has a report. The comment then
   states which commit the base is and how many commits it is behind the merge base.
4. If none is found, the action falls back to measuring the base itself (checking out the merge
   base in a separate git worktree), where the app kind allows it. For mobile archives it
   cannot build the base app (ADR 0009); it reports the head only and says why.
5. Deterministic metrics (bundle and archive sizes) always use this mechanism. Lighthouse is
   noisy and machine-dependent; whether its base may come from a cached report is decided in
   ADR 0007.

## Consequences

- A typical PR measures only the head.
- Artifact retention is limited (90 days by default, configurable per repository and
  organisation), so repositories with rare pushes will hit the fallback more often.
- An ancestor base can include changes from other merged PRs; the comment must say so.

## Alternatives considered

- Always measure base and head in the same job: simplest and most accurate, but slow.
- Store reports in a branch or a gist: needs `contents: write` or a secret, against ADR 0005.
- An external service: contradicts "no secrets, no account".
