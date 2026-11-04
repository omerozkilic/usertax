// Builds the npm package of the CLI in release/npm/: one bundled file with @usertax/core and
// @usertax/measure inside, so `npx usertax` installs no workspace packages. lighthouse and
// chrome-launcher stay optional peer dependencies. Run after `pnpm build`.
//
// Usage: node scripts/pack-cli.js   (then: cd release/npm && npm pack --dry-run)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'release', 'npm');
const cli = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
const measure = JSON.parse(readFileSync(join(root, 'packages/measure/package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'bin'), { recursive: true });
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [
    join(root, 'packages/cli/src/index.ts'),
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=esm',
    `--outfile=${join(out, 'dist/index.js')}`,
    '--external:lighthouse',
    '--external:lighthouse/*',
    '--external:chrome-launcher',
    "--banner:js=import { createRequire as __usertaxCreateRequire } from 'node:module'; const require = __usertaxCreateRequire(import.meta.url);",
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
copyFileSync(join(root, 'packages/cli/bin/usertax.js'), join(out, 'bin/usertax.js'));
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'));
copyFileSync(join(root, 'README.md'), join(out, 'README.md'));
const pkg = {
  name: 'usertax',
  version: cli.version,
  description: cli.description,
  license: 'MIT',
  type: 'module',
  repository: { type: 'git', url: 'git+https://github.com/omerozkilic/usertax.git' },
  homepage: 'https://github.com/omerozkilic/usertax#readme',
  bugs: 'https://github.com/omerozkilic/usertax/issues',
  keywords: cli.keywords,
  engines: cli.engines,
  bin: { usertax: './bin/usertax.js' },
  files: ['bin', 'dist', 'README.md', 'LICENSE'],
  peerDependencies: measure.peerDependencies,
  peerDependenciesMeta: measure.peerDependenciesMeta,
};
writeFileSync(join(out, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
process.stdout.write(`packed usertax ${pkg.version} into ${out}\n`);
