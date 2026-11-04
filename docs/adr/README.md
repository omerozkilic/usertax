# Architecture Decision Records

Decisions that shape usertax, recorded in a lightweight [MADR](https://adr.github.io/madr/) style.
A new ADR starts as **Proposed**, becomes **Accepted** once the maintainer agrees, and is
never deleted: a later ADR **supersedes** it instead.

| ADR                                                  | Title                                                      | Status   |
| ---------------------------------------------------- | ---------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)        | Record architecture decisions                              | Accepted |
| [0002](0002-package-boundaries.md)                   | Package boundaries: core, measure, cli, action             | Accepted |
| [0003](0003-report-schema-as-public-contract.md)     | The report JSON schema is the public contract              | Accepted |
| [0004](0004-base-reports-from-artifacts.md)          | Reuse base reports stored as workflow artifacts            | Accepted |
| [0005](0005-fork-safe-two-workflow-pattern.md)       | Fork-safe two-workflow pattern                             | Accepted |
| [0006](0006-two-repository-distribution.md)          | Source repository plus thin action repository              | Accepted |
| [0007](0007-lighthouse-noise-model.md)               | Lighthouse noise model                                     | Accepted |
| [0008](0008-attribution-lockfile-and-source-maps.md) | Attribution from lockfile diffs and source maps            | Accepted |
| [0009](0009-mobile-archives-via-zip-parsing.md)      | Analyse mobile archives by parsing ZIP files               | Accepted |
| [0010](0010-runtime-and-toolchain.md)                | Runtime and toolchain                                      | Accepted |
| [0011](0011-versioning-and-releases.md)              | Versioning and releases                                    | Accepted |
| [0012](0012-zero-config-detection.md)                | Zero-config detection and configuration file               | Accepted |
| [0013](0013-no-llm-in-core.md)                       | No LLM in the core                                         | Accepted |
| [0014](0014-missing-base-reports.md)                 | Missing base reports are recreated by the measure workflow | Accepted |
| [0015](0015-mcp-server-in-the-cli.md)                | The MCP server is a command of the CLI                     | Accepted |

Use [`template.md`](template.md) for new records.
