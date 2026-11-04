# usertax — PR performance cost

**What does this pull request cost your users?** Web and mobile bundle sizes, Lighthouse lab
metrics and app archive sizes for every pull request, explained by the dependency that caused
the change. Deterministic: no LLM, no API key, no account.

This repository holds the released action only. Source, documentation and issues:
**[omerozkilic/usertax](https://github.com/omerozkilic/usertax)**.

## Usage

Two workflows keep pull requests from forks safe: one measures with a read-only token, the
other posts the comment from your default branch.

```yaml
# .github/workflows/usertax.yml
name: usertax
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  measure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm ci && npm run build
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

```yaml
# .github/workflows/usertax-comment.yml
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
      - uses: actions/checkout@v6
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

Inputs, outputs and configuration:
[docs/github-action.md](https://github.com/omerozkilic/usertax/blob/main/docs/github-action.md)
and [docs/configuration.md](https://github.com/omerozkilic/usertax/blob/main/docs/configuration.md).

## License

[MIT](LICENSE)
