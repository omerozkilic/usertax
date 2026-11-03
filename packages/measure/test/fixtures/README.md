# Test fixtures

## `vite-dist/`

Real output of `pnpm --filter @usertax-examples/vite-app build` (Vite 8.3.5, React 19.3.1),
copied unchanged except that `sourcesContent` was removed from the source maps to keep the
fixture small. usertax does not read `sourcesContent`.

To refresh it, build the example and copy `examples/vite-app/dist/` here, then strip
`sourcesContent` from `assets/*.map`. Tests that depend on exact byte counts read them from the
files, so they keep working after a refresh.
