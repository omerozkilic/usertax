# Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please) from
Conventional Commits (ADR 0011). Every push to `main` updates a release pull request with the
next version and the CHANGELOG; nothing is published until a maintainer merges it.

All packages share one version. Before 1.0.0, `feat` bumps the minor version and `fix` the patch;
the first release is `v0.1.0`, and the action's major tag is `v0` until 1.0.0.

## What merging the release pull request does

1. release-please tags `vX.Y.Z` and creates the GitHub release.
2. **Action** (if `ACTION_REPO_DEPLOY_KEY` is set): the bundled action, `action.yml`, its README
   and the license are pushed to [`omerozkilic/usertax-action`](https://github.com/omerozkilic/usertax-action),
   tagged `vX.Y.Z`, and the major tag `vX` is moved (ADR 0006).
3. **npm** (if the repository variable `NPM_TRUSTED_PUBLISHING` is `true`): `release/npm/`
   (built by `pnpm pack:cli`, one bundled file) is published as
   [`usertax`](https://www.npmjs.com/package/usertax) through npm trusted publishing: GitHub's
   OIDC token proves that this workflow built the package, npm adds provenance, and no npm token
   is stored in the repository.

Without the deploy key the action job logs a notice and does nothing; without the variable the
npm job is skipped.

## One-time setup (maintainer)

These steps cannot be undone easily, so they are done by hand:

1. **Action repository.** Create the public repository `omerozkilic/usertax-action` (empty, with
   a `main` branch). Generate a key pair (`ssh-keygen -t ed25519 -f usertax-action -N ""`), add
   the public key as a **deploy key with write access** in that repository, and the private key
   as the secret `ACTION_REPO_DEPLOY_KEY` in this repository.
2. **npm.** Trusted publishing can only be configured for a package that already exists, so
   the first version is published by hand, after the first release pull request is merged:

   ```bash
   git checkout v0.1.0 && pnpm install && pnpm build && pnpm pack:cli
   cd release/npm && npm publish --access public   # asks for npm login and 2FA
   ```

   Then, on npmjs.com, open the `usertax` package → Settings → Trusted publishing, add GitHub
   Actions with repository `omerozkilic/usertax` and workflow `release.yml`, and set the
   repository variable `NPM_TRUSTED_PUBLISHING` to `true` (Settings → Secrets and variables →
   Actions → Variables). Later releases are published by the workflow.

3. **Public repository.** Make this repository public, enable private vulnerability reporting
   (Settings → Security), and CodeQL starts running.
4. **Marketplace.** After the first release in `usertax-action`, publish it from that
   repository's release page ("Publish this Action to the GitHub Marketplace", requires 2FA).
   The listing name comes from `action.yml`: "usertax — PR performance cost".

## Notes

- Pull requests created by release-please with the default `GITHUB_TOKEN` do not trigger other
  workflows, so the release pull request shows no CI checks. Its content (version and CHANGELOG)
  comes from commits that already passed CI on `main`.
- Verify the package locally with `pnpm build && pnpm pack:cli && (cd release/npm && npm pack --dry-run)`.
