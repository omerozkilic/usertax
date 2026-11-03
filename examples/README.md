# Examples

Real apps that usertax measures in CI. Numbers in the documentation come from these apps, with
the commands to reproduce them.

| App                     | Framework                                       | Status         |
| ----------------------- | ----------------------------------------------- | -------------- |
| [`vite-app`](vite-app/) | Vite + React, two HTML entries and a lazy chunk | Measured in CI |
| `next-app`              | Next.js                                         | Milestone 4    |
| `expo-app`              | Expo                                            | Milestone 5    |
| `bare-rn-app`           | Bare React Native                               | Milestone 5    |

## Reproduce

```bash
pnpm install
pnpm build
pnpm --filter @usertax-examples/vite-app build
node packages/cli/bin/usertax.js measure examples/vite-app --output vite-report.json
node packages/cli/bin/usertax.js diff vite-report.json
```
