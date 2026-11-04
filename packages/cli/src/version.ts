import { createRequire } from 'node:module';

declare const __USERTAX_VERSION__: string | undefined;

/**
 * The usertax version. Bundles (the GitHub Action, the npm package) inject it at build time,
 * because their published directory may have no package.json next to the code (the action
 * repository has none); from the workspace it is read from this package's package.json.
 */
export const VERSION: string =
  typeof __USERTAX_VERSION__ === 'string'
    ? __USERTAX_VERSION__
    : (createRequire(import.meta.url)('../package.json') as { version: string }).version;
