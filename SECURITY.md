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
