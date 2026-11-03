# Demo: a pull request that adds a dependency

[`add-moment.md`](add-moment.md) is the comment usertax renders for a real change, measured
on a real build. It is produced by:

```bash
pnpm install
pnpm build
pnpm demo --output docs/demo/add-moment.md
```

The script ([`scripts/demo-add-dependency.js`](../../scripts/demo-add-dependency.js)):

1. checks out `HEAD` into a temporary git worktree and installs it with the committed lockfile;
2. builds [`examples/vite-app`](../../examples/vite-app) and measures it (the base);
3. adds `moment@2.30.1`, uses it in `src/App.jsx`, commits, builds and measures again (the head);
4. renders the diff with `usertax diff`.

CI runs the same script on every pull request and fails if the comment no longer attributes the
growth to `moment`.

The committed output was generated on 2026-11-03 with Node.js 22.23.4, pnpm 10.28.0, Vite
8.3.5 and React 19.3.1 on Linux x64. Sizes depend only on the package versions and the build
tool, so the numbers reproduce on other machines with the same lockfile; the commit SHAs in the
header differ per run.
