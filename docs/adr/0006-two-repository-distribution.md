# 0006. Source repository plus thin action repository

- Status: Accepted
- Date: 2026-11-03

## Context

GitHub Marketplace publishes an action immediately only when the repository has a single
`action.yml` at its root and no workflow files; otherwise the listing needs a review by
GitHub. The source repository needs CI workflows, example apps and binary test fixtures
(small APK/AAB/IPA files). GitHub downloads the whole repository at the referenced tag for
every run of an action, so a large source repository also slows down every user's job.

## Decision

- `omerozkilic/usertax` holds the source, CI, examples and documentation. It stays private
  until v1 is implemented and tested, then becomes public.
- `omerozkilic/usertax-action` (created when v1 is ready) holds only `action.yml`, the
  bundled `dist/`, `README.md` and `LICENSE`. Users write
  `uses: omerozkilic/usertax-action@v1`.
- A release workflow in the source repository builds the action, pushes it to the thin
  repository with a deploy key, and creates the tag `vX.Y.Z` there and moves `vX`.
- Marketplace publishing is done manually through the web UI with 2FA, after v1.

## Consequences

- Fast action downloads and immediate Marketplace publishing.
- One deploy key secret, used only by the release workflow on the default branch.
- Issues may be opened in the wrong repository; the thin repository points to the source one.

## Alternatives considered

- Single repository: simpler, but larger downloads and Marketplace review on every release.
