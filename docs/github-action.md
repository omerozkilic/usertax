# GitHub Action

> [!NOTE]
> The action is not released yet. This repository runs it on its own pull requests
> ([`usertax.yml`](../.github/workflows/usertax.yml) and
> [`usertax-comment.yml`](../.github/workflows/usertax-comment.yml)). After the first release it
> will be available as `omerozkilic/usertax-action@v0` (ADR 0006; the major tag follows the
> version, `v0` during 0.x); the examples below use that name.

## Fork-safe setup (recommended)

Two workflows (ADR 0005). The first builds and measures the pull request with a read-only token
and no secrets; the second runs the action from your default branch, never the pull request's
code, and posts the comment.

`.github/workflows/usertax.yml`:

```yaml
name: usertax
on:
  pull_request:
  push:
    branches: [main] # stores the base report for later pull requests
  workflow_dispatch: # run on main to recreate a missing base report
permissions:
  contents: read
jobs:
  measure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm ci && npm run build # however you build your apps, with source maps
      - id: usertax
        uses: omerozkilic/usertax-action@v0
        with:
          mode: measure
      - uses: actions/upload-artifact@v7
        with:
          name: ${{ steps.usertax.outputs.artifact-name }}
          path: ${{ steps.usertax.outputs.report }}
          retention-days: 90
```

`.github/workflows/usertax-comment.yml`:

```yaml
name: usertax comment
on:
  workflow_run:
    workflows: [usertax]
    types: [completed]
permissions:
  contents: read
  actions: read
  pull-requests: write
  statuses: write # the "usertax" commit status on the pull request
jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6 # the default branch: your trusted configuration
      - uses: actions/download-artifact@v8
        with:
          name: usertax-head
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
          path: .usertax-head
      - uses: omerozkilic/usertax-action@v0
        with:
          mode: comment
          head-report: .usertax-head/usertax-report.json
```

Pin actions by commit SHA in your workflows; the tags above keep the example short.

## What happens

1. **Measure** (`mode: measure`) runs `usertax measure` on the checked-out repository: the apps
   of `usertax.config.*`, or the discovered workspace apps ([configuration](configuration.md)).
   The apps must already be built. The report is written to `usertax-report.json` and the step
   outputs the artifact name: `usertax-base-<sha>` on pushes to the default branch,
   `usertax-head` otherwise.
2. **Comment** (`mode: comment`) validates the downloaded head report against the schema, finds
   the pull request from the `workflow_run` event (for fork PRs by head repository and branch,
   checked against the head SHA), computes the merge base with GitHub's compare API and looks
   for `usertax-base-<merge-base>`, falling back to up to 20 ancestors (ADR 0004). It renders
   the comparison with the budgets of your configuration, creates or updates one comment
   (identified by a hidden marker), writes the job summary, and sets the `usertax` commit status
   on the pull request head. A `workflow_run` job's own result does not show on the pull
   request, so the status is what reviewers and branch protection see: it fails when a budget
   fails, unless `fail-on-budget: false`, which only reports. The step fails too.

When no base report exists (the default branch was not measured within the artifact retention,
or the pull request branches off an older commit), the comment shows head values and says so.
Run the measure workflow on the default branch (`workflow_dispatch`) and update the pull request
branch to get a comparison (ADR 0014).

Strings from reports are escaped or shown as code; links in comments only come from usertax's own
data. The head report is refused if it was measured for another commit than the pull request
head.

## Single workflow

For repositories that do not accept pull requests from forks, `mode: all` measures and comments
in one job of a `pull_request` workflow (`permissions: actions: read, pull-requests: write,
statuses: write`). On a
fork pull request the token is read-only and the comment step fails, which is why the two-workflow
setup is the default.

## Inputs and outputs

| Input               | Default               | Meaning                                                                   |
| ------------------- | --------------------- | ------------------------------------------------------------------------- |
| `mode`              | `measure`             | `measure`, `comment` or `all`.                                            |
| `working-directory` | `.`                   | Repository root to measure.                                               |
| `config`            | `usertax.config.*`    | Configuration file, relative to the working directory.                    |
| `report`            | `usertax-report.json` | Where `measure` writes the report.                                        |
| `head-report`       | –                     | `comment`: the downloaded head report.                                    |
| `github-token`      | `github.token`        | Comment mode: `actions: read`, `pull-requests: write`, `statuses: write`. |
| `fail-on-budget`    | `true`                | Fail the step and the commit status when a budget fails.                  |
| `commit-status`     | `true`                | Comment mode: set the `usertax` commit status on the PR head.             |

| Output          | Meaning                                            |
| --------------- | -------------------------------------------------- |
| `report`        | `measure`: absolute path of the report.            |
| `artifact-name` | `measure`: `usertax-base-<sha>` or `usertax-head`. |
| `comment-url`   | `comment`: URL of the comment.                     |
| `status`        | `comment`: `pass`, `warn` or `fail`.               |

Lighthouse runs need `lighthouse` and `chrome-launcher` installed in the measured repository
(`npm install -D lighthouse chrome-launcher`); GitHub-hosted runners include Chrome.
