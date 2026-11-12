# Examples

Real apps that usertax measures in CI. Numbers in the documentation come from these apps, with
the commands to reproduce them.

| App                           | Framework                                                                          | Status                          |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| [`vite-app`](vite-app/)       | Vite + React, two HTML entries and a lazy chunk                                    | Measured in CI, with Lighthouse |
| [`next-app`](next-app/)       | Next.js 16 App Router (Turbopack)                                                  | Measured in CI, with Lighthouse |
| [`rsbuild-app`](rsbuild-app/) | Rsbuild + React, two HTML entries and a lazy chunk                                 | Measured in CI                  |
| [`expo-app`](expo-app/)       | Expo 58 (Hermes bundles from `expo export`; release APK in the `android` workflow) | Measured in CI                  |
| [`bare-rn-app`](bare-rn-app/) | Bare React Native 0.88 (JavaScript bundles from `react-native bundle`)             | Measured in CI                  |

## Reproduce

```bash
pnpm install
pnpm build
pnpm --filter @usertax-examples/vite-app build
node packages/cli/bin/usertax.js measure examples/vite-app --output vite-report.json
node packages/cli/bin/usertax.js diff vite-report.json
```
