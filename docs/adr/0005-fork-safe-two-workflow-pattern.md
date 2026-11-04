# 0005. Fork-safe two-workflow pattern

- Status: Accepted
- Date: 2026-11-03

## Context

Measuring a PR means building and running its code, which is untrusted when it comes from a
fork. `pull_request_target` runs with a write token and secrets in the context of the base
repository, so building PR code there is a well-known way to compromise a repository. On the
other hand, a plain `pull_request` run from a fork gets a read-only token and cannot comment.

## Decision

The documented setup uses two workflows:

1. **Measure** (`on: pull_request`, `permissions: contents: read`). Builds the PR, runs
   `usertax` in `mode: measure` and uploads the head report as an artifact. No secrets needed.
2. **Comment** (`on: workflow_run` of the measure workflow, `permissions: actions: read,
pull-requests: write, checks: write`). Never checks out or executes PR code. It downloads
   the report, treats it as untrusted data and posts the sticky comment, the job summary and
   the check run.

Rules for the comment workflow:

- The report is validated against the schema (ADR 0003) and size-capped before use.
- All strings taken from the report are escaped when rendered; raw HTML is never emitted.
- The PR number and head SHA are taken from the `workflow_run` event and the GitHub API, never
  from the artifact, and the PR's current head SHA must match the measured SHA. For fork PRs,
  where `workflow_run.pull_requests` is empty, the PR is found by head repository and branch
  and then checked against the SHA.
- The sticky comment is found by a hidden marker and only comments authored by the token's
  identity are updated.

A single-workflow `mode: all` exists for repositories that do not accept fork PRs; on a fork PR
it measures but cannot comment, and says so in the job summary.

No input of the action requires a secret.

## Implementation notes (milestone 6)

- `packages/action` implements `measure`, `comment` and `all`. The measure workflow uploads the
  report with `actions/upload-artifact`; the comment workflow downloads it with
  `actions/download-artifact` (`run-id` of the triggering run) and runs the action checked out
  from the default branch.
- The head report is refused when its SHA differs from the pull request head. This catches
  mix-ups, not attacks: the artifact is produced by untrusted code, so safety rests on schema
  validation, size limits and escaping, which apply to every string in the comment.
- The sticky comment is the first comment by a bot account that starts with the marker.
- A check run is not created yet; the job's own status and summary carry the result.

## Implementation notes (budget status on the pull request)

- The comment job's own result is attached to the default branch, not to the pull request, so a
  failed budget was invisible on the PR. The comment mode now sets a commit status
  (`context: usertax`) on the PR head with the budget counts and a link to the comment, which
  branch protection can require. This needs `statuses: write` instead of the `checks: write`
  planned above: commit statuses are simpler to create from another workflow and attach to the
  commit regardless of which check suite created them. Without the permission, the action logs
  a warning and still comments (`commit-status: false` turns it off).

## Consequences

- Safe by default for public repositories.
- Two workflow files to copy instead of one; the README provides both.

## Alternatives considered

- `pull_request_target` with checkout of the PR head: rejected, unsafe.
- Single `pull_request` workflow only: no comments on fork PRs.
