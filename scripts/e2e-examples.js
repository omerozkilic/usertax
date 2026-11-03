// End-to-end check of the example apps: measure each built example with the CLI, validate the
// report and check invariants that must hold for any real build. Prints the Markdown report so
// CI can show it in the job summary. Run after `pnpm build` and building the examples.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReport } from '../packages/core/dist/index.js';

const cli = new URL('../packages/cli/bin/usertax.js', import.meta.url).pathname;
const examples = ['examples/vite-app'];
const work = mkdtempSync(join(tmpdir(), 'usertax-e2e-'));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

for (const example of examples) {
  const output = join(work, `${example.replaceAll('/', '-')}.json`);
  execFileSync(process.execPath, [cli, 'measure', example, '--output', output], {
    stdio: 'inherit',
  });
  const report = parseReport(JSON.parse(readFileSync(output, 'utf8')));
  const [app] = report.apps;
  check(app !== undefined, `${example}: no app in report`);
  if (app === undefined) continue;

  const js = (app.assets ?? []).filter((asset) => asset.type === 'js');
  check(js.length > 0, `${example}: no JavaScript assets`);
  for (const asset of js) {
    check(asset.packages !== undefined, `${example}: ${asset.file} has no source-map attribution`);
    const attributed =
      (asset.packages ?? []).reduce((sum, p) => sum + p.bytes, 0) +
      (asset.firstPartyBytes ?? 0) +
      (asset.unattributedBytes ?? 0);
    check(
      attributed === asset.raw,
      `${example}: ${asset.file} attributes ${attributed} of ${asset.raw} bytes`,
    );
  }
  const keys = new Set((app.assets ?? []).map((asset) => asset.key));
  for (const route of app.routes ?? []) {
    for (const key of route.assets)
      check(keys.has(key), `${example}: route ${route.route} references unknown asset ${key}`);
  }
  check(
    js.some((asset) => (asset.packages ?? []).some((p) => p.name === 'react-dom')),
    `${example}: react-dom not found in any chunk`,
  );

  check(
    (app.dependencies ?? []).some((d) => d.name === 'react-dom' && d.direct),
    `${example}: react-dom missing from the lockfile dependencies`,
  );

  process.stdout.write(execFileSync(process.execPath, [cli, 'diff', output], { encoding: 'utf8' }));
}

if (failures.length > 0) {
  process.stderr.write(`\nE2E failures:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
