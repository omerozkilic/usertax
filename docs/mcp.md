# MCP server

`usertax mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server on
standard input and output. Coding agents such as Claude Code can then measure a change and
explain its cost with usertax's numbers instead of guessing them (ADR 0015). The server uses no
network service and no language model; it runs the same code as the CLI.

## Setup

Claude Code:

```bash
claude mcp add usertax -- npx -y @usertax/cli mcp
```

Other clients (`mcpServers` configuration):

```json
{ "mcpServers": { "usertax": { "command": "npx", "args": ["-y", "@usertax/cli", "mcp"] } } }
```

From a clone, `node packages/cli/bin/usertax.js mcp` after `pnpm install && pnpm build` works the
same. Relative paths in tool calls are resolved
against the directory the server was started in, normally the project root.

## Tools

| Tool              | Input                                                                             | Result                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `measure`         | `path`; optional `output`, `config`, `outDir`, `framework`, `bundles`, `archives` | Measures built apps like `usertax measure` and saves the report (default: a temporary file); returns its path and the head values.        |
| `compare`         | `head`; optional `base`, `config`, `format`, `compression`, `top`                 | Exactly the output of `usertax diff`, budgets included.                                                                                   |
| `explain_package` | `package`, `report`; optional `base`                                              | Minified bytes of the package per shipped file, lockfile versions with direct or `via` dependencies, the same for the base, alternatives. |
| `alternatives`    | `package`                                                                         | Curated alternatives from e18e module-replacements, with the guide link, or a statement that the dataset has none.                        |

`measure` never builds the app and does not run Lighthouse (a run takes minutes); build first,
and use `usertax measure --lighthouse` from a terminal for lab metrics.

## Example

Asked "what does adding moment cost?", an agent can build the app, call `measure` with
`output: base.json`, add the dependency and rebuild, call `measure` with `output: head.json`,
then `compare` with `head: head.json, base: base.json` and `explain_package` for `moment`. The
numbers it reports are the ones in [the demo](demo/add-moment.md).
