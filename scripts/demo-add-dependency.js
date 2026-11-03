// Reproducible demo of a pull request that adds a dependency, measured for real:
//
//   1. check out HEAD into a temporary git worktree and install with the committed lockfile
//   2. build examples/vite-app and measure it (base)
//   3. add moment@2.30.1 to the app, use it in a component, commit, build and measure (head)
//   4. render the PR comment that usertax would post
//
// Usage: node scripts/demo-add-dependency.js [--output docs/demo/add-moment.md]
// Needs `pnpm build` first and network access to the npm registry for moment.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const cli = join(repo, 'packages/cli/bin/usertax.js');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
const work = mkdtempSync(join(tmpdir(), 'usertax-demo-'));
const tree = join(work, 'repo');
const run = (cmd, args, cwd = tree) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const app = join(tree, 'examples/vite-app');
const git = ['-c', 'user.name=usertax demo', '-c', 'user.email=demo@usertax.invalid'];

try {
  run('git', ['worktree', 'add', '--detach', tree, 'HEAD'], repo);
  run('pnpm', ['install', '--frozen-lockfile', '--filter', '@usertax-examples/vite-app...']);
  run('pnpm', ['--filter', '@usertax-examples/vite-app', 'build']);
  run(process.execPath, [cli, 'measure', app, '--output', join(work, 'base.json')]);

  run('pnpm', ['--filter', '@usertax-examples/vite-app', 'add', '--save-exact', 'moment@2.30.1']);
  const component = join(app, 'src/App.jsx');
  const source = readFileSync(component, 'utf8')
    .replace(
      "import { lazy, Suspense, useState } from 'react';",
      "import moment from 'moment';\nimport { lazy, Suspense, useState } from 'react';",
    )
    .replace(
      '<p>A small Vite + React app used to test usertax measurements.</p>',
      "<p>A small Vite + React app used to test usertax measurements.</p>\n      <p>Built {moment().format('LL')}.</p>",
    );
  writeFileSync(component, source);
  run('git', [
    ...git,
    'commit',
    '--quiet',
    '--no-verify',
    '-am',
    'feat: show the build date with moment',
  ]);
  run('pnpm', ['--filter', '@usertax-examples/vite-app', 'build']);
  run(process.execPath, [cli, 'measure', app, '--output', join(work, 'head.json')]);

  const markdown = run(process.execPath, [
    cli,
    'diff',
    join(work, 'head.json'),
    '--base',
    join(work, 'base.json'),
  ]);
  // The demo doubles as an end-to-end test of attribution.
  for (const expected of [
    '| `moment` | web | – |',
    'added `2.30.1` (direct)',
    'e18e.dev/docs/replacements/moment',
  ]) {
    if (!markdown.includes(expected)) throw new Error(`demo output does not contain ${expected}`);
  }
  if (output === undefined) process.stdout.write(markdown);
  else writeFileSync(join(repo, output), markdown);
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', tree], { cwd: repo, stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
}
