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

## Consequences

- Safe by default for public repositories.
- Two workflow files to copy instead of one; the README provides both.

## Alternatives considered

- `pull_request_target` with checkout of the PR head: rejected, unsafe.
- Single `pull_request` workflow only: no comments on fork PRs.
