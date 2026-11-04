// Bundles the action into dist/index.js: one file, with lighthouse and chrome-launcher left
// external (optional, loaded from the measured project). The version is injected because the
// action repository has no package.json next to dist/ (ADR 0006).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
execFileSync(
  join(dir, '../../node_modules/.bin/esbuild'),
  [
    join(dir, 'src/main.ts'),
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=esm',
    `--outfile=${join(dir, 'dist/index.js')}`,
    '--external:lighthouse',
    '--external:lighthouse/*',
    '--external:chrome-launcher',
    `--define:__USERTAX_VERSION__=${JSON.stringify(version)}`,
    "--banner:js=import { createRequire as __usertaxCreateRequire } from 'node:module'; const require = __usertaxCreateRequire(import.meta.url);",
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
process.stdout.write(`bundled usertax action ${version} into ${join(dir, 'dist/index.js')}\n`);
