// Runs the bundled GitHub Action the way the action repository ships it: action.yml and
// dist/index.js copied into an empty directory with no package.json or node_modules (ADR 0006).
// It measures a copy of the Vite build fixture in measure mode and checks the report.
// Usage: node scripts/action-smoke.js   (after `pnpm build:action`)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'packages/action/package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'usertax-action-smoke-'));

const action = join(work, 'usertax-action');
mkdirSync(join(action, 'dist'), { recursive: true });
cpSync(join(root, 'packages/action/action.yml'), join(action, 'action.yml'));
cpSync(join(root, 'packages/action/dist/index.js'), join(action, 'dist/index.js'));

const app = join(work, 'app');
cpSync(join(root, 'packages/measure/test/fixtures/vite-dist'), join(app, 'dist'), {
  recursive: true,
});
writeFileSync(join(app, 'package.json'), '{"name":"smoke","devDependencies":{"vite":"8"}}');

const output = join(work, 'github-output.txt');
writeFileSync(output, '');
execFileSync(process.execPath, [join(action, 'dist/index.js')], {
  cwd: work,
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    GITHUB_WORKSPACE: app,
    GITHUB_OUTPUT: output,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/smoke',
    GITHUB_SHA: 'a'.repeat(40),
    INPUT_MODE: 'measure',
  },
});
const report = JSON.parse(readFileSync(join(app, 'usertax-report.json'), 'utf8'));
const failures = [];
if (report.tool?.version !== version)
  failures.push(`report says usertax ${String(report.tool?.version)}, expected ${version}`);
if (!(report.apps?.[0]?.assets?.length > 0)) failures.push('report has no assets');
if (!readFileSync(output, 'utf8').includes('usertax-head'))
  failures.push('artifact-name output missing');
if (failures.length > 0) {
  process.stderr.write(`action smoke test failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `action ok: usertax ${version} measured ${report.apps[0].assets.length} assets\n`,
);
