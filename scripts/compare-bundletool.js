// Compares usertax's download estimate of an AAB with `bundletool get-size total`, for several
// device profiles (see docs/benchmarks). Needs Java and a bundletool jar; usertax itself does not.
//
// Usage: node scripts/compare-bundletool.js app.aab bundletool.jar [--ks debug.keystore] [--output result.json]
//
// The keystore signs the generated APKs (alias `androiddebugkey`, password `android`, as in
// React Native and Expo projects). Without one, bundletool uses its own default.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { estimateDownloads, readZipEntries } from '../packages/measure/dist/index.js';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const [aab, jar] = args;
if (aab === undefined || jar === undefined) {
  process.stderr.write('usage: node scripts/compare-bundletool.js app.aab bundletool.jar\n');
  process.exit(2);
}

// Device profiles: ABI, screen density (name and dpi) and locale.
const DENSITY = { mdpi: 160, hdpi: 240, xhdpi: 320, xxhdpi: 480, xxxhdpi: 640 };
const profiles = [
  ['arm64-v8a', 'mdpi', 'en'],
  ['arm64-v8a', 'hdpi', 'en'],
  ['arm64-v8a', 'xhdpi', 'en'],
  ['arm64-v8a', 'xxhdpi', 'en'],
  ['arm64-v8a', 'xxxhdpi', 'en'],
  ['arm64-v8a', 'xxhdpi', 'tr'],
  ['arm64-v8a', 'xxhdpi', 'zh'],
  ['armeabi-v7a', 'hdpi', 'en'],
  ['armeabi-v7a', 'xhdpi', 'en'],
  ['x86', 'xhdpi', 'en'],
  ['x86_64', 'xxhdpi', 'en'],
];

const bundletool = (...command) =>
  execFileSync('java', ['-jar', jar, ...command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const work = mkdtempSync(join(tmpdir(), 'usertax-bundletool-'));
const apks = join(work, 'app.apks');
const keystore = flag('--ks');
bundletool(
  'build-apks',
  `--bundle=${aab}`,
  `--output=${apks}`,
  ...(keystore === undefined
    ? []
    : [
        `--ks=${keystore}`,
        '--ks-pass=pass:android',
        '--ks-key-alias=androiddebugkey',
        '--key-pass=pass:android',
      ]),
);

const handle = await open(aab, 'r');
const bytes = statSync(aab).size;
const entries = await readZipEntries(handle, bytes);
await handle.close();
const rows = [];
for (const [abi, density, locale] of profiles) {
  const spec = join(work, 'spec.json');
  writeFileSync(
    spec,
    JSON.stringify({
      supportedAbis: [abi],
      supportedLocales: [locale],
      screenDensity: DENSITY[density],
      sdkVersion: 34,
    }),
  );
  const [min, max] = bundletool('get-size', 'total', `--apks=${apks}`, `--device-spec=${spec}`)
    .trim()
    .split('\n')
    .pop()
    .split(',')
    .map(Number);
  const [estimate] = estimateDownloads(entries, [{ abi, density }]);
  rows.push({
    abi,
    density,
    locale,
    bundletool: min,
    bundletoolMax: max,
    usertax: estimate?.bytes,
  });
}

const result = {
  aab: {
    file: basename(aab),
    bytes,
    sha256: createHash('sha256').update(readFileSync(aab)).digest('hex'),
  },
  bundletool: bundletool('version').trim(),
  rows,
};
const output = flag('--output');
if (output !== undefined) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);

const pad = (value, width) => String(value ?? '-').padStart(width);
process.stdout.write(`${basename(aab)}: ${bytes} bytes, bundletool ${result.bundletool}\n`);
process.stdout.write('abi          density  loc  bundletool    usertax    diff\n');
for (const row of rows) {
  const diff = row.usertax === undefined ? undefined : row.usertax - row.bundletool;
  const percent = diff === undefined ? '' : ` (${((diff / row.bundletool) * 100).toFixed(2)} %)`;
  process.stdout.write(
    `${row.abi.padEnd(12)} ${row.density.padEnd(8)} ${row.locale.padEnd(3)} ${pad(row.bundletool, 11)} ${pad(row.usertax, 10)} ${pad(diff, 7)}${percent}\n`,
  );
}
