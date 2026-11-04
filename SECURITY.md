# Security policy

## Supported versions

Until 1.0.0 only the latest release receives fixes. After 1.0.0, the latest minor release of the
current major version is supported.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**. You will get an answer
within 7 days.

## Security model

usertax is designed to run on pull requests from forks without exposing secrets or write
tokens to untrusted code. The recommended setup and its rules are described in
[ADR 0005](docs/adr/0005-fork-safe-two-workflow-pattern.md). In short:

- PR code is built and measured only in a `pull_request` workflow with a read-only token.
- Comments are posted from a `workflow_run` workflow that never executes PR code and treats
  the measured report as untrusted data (schema validation, size limits, escaping).
- The action needs no secrets.

Reports of ways to break these guarantees are especially welcome.

## Supply chain

- **No runtime dependencies.** `@usertax/cli` and the action are single bundled files (zod, yaml,
  `@jridgewell/sourcemap-codec` and the MCP SDK inside). `npm audit` on a project that installs
  only `@usertax/cli` reports no vulnerabilities. `lighthouse` and `chrome-launcher` are optional
  peer dependencies that you install yourself, so their dependency tree is audited by your own
  tooling.
- **Releases** are built in CI from the release tag, with npm provenance. npm versions are
  staged by CI and published only after a maintainer approves them with 2FA; no npm token
  exists ([releasing](docs/releasing.md)).
- **Runtime.** Supported Node.js releases include the October 2026 security fixes
  (CVE-2026-111497 and others, ADR 0010); the CLI warns on older runtimes.
- **Development dependencies** are audited with `pnpm audit`. Overrides in
  `pnpm-workspace.yaml` pin patched versions of transitive dev dependencies where upstream has
  not updated yet. One low-severity advisory remains without a fix (`deepmerge`,
  GHSA-gcqx-w48m-w2h4) in the React Native CLI used only by `examples/bare-rn-app`.

### Capabilities that scanners report

Package scanners such as Socket flag capabilities, not vulnerabilities. usertax's are:

| Capability              | Why                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Filesystem access       | Reads build output, source maps, lockfiles and archives; writes the report you ask for. |
| Shell / child processes | `git rev-parse`, `next start` for Lighthouse, and your `--start` command.               |
| Network access          | Local servers for Lighthouse; the action calls the GitHub API. No telemetry.            |
| Environment variables   | `GITHUB_*` variables and action inputs (`INPUT_*`).                                     |
| `new Function`          | In the bundled Ajv (MCP SDK) for MCP elicitation schemas, which usertax does not use.   |
