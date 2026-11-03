# 0011. Versioning and releases

- Status: Accepted
- Date: 2026-11-03

## Context

Users pin the action by major tag (`@v1`) or exact version, and the CLI is installed from npm.
Release notes must be accurate without manual bookkeeping.

## Decision

- Conventional Commits. PRs are squash-merged and the PR title is checked by CI.
- release-please in manifest mode creates release PRs with the CHANGELOG. All packages share
  one version.
- Semantic versioning. A change to report schema semantics (ADR 0003), action inputs or
  outputs, or CLI flags that breaks existing usage is a major release.
- Tags in the source repository: `vX.Y.Z`. The thin action repository gets `vX.Y.Z` and a
  moving `vX` (ADR 0006).
- The release-please workflow is added when v1 is being prepared (milestone 7), so that no
  release PRs or tags appear during early development. Creating tags, publishing to npm and
  publishing to Marketplace are done only with the maintainer's approval.

## Consequences

- CHANGELOG and versions follow from commit history.
- PR titles must follow the convention.

## Alternatives considered

- Changesets: good for independently versioned packages; we version everything together.
