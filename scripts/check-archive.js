// Checks a usertax report of a real Android build: the APK must be broken down into the
// categories a React Native release build has, with a Hermes bundle. Used by the android
// workflow, which builds examples/expo-app into a real APK on a GitHub-hosted runner.
//
// Usage: node scripts/check-archive.js report.json
import { readFileSync } from 'node:fs';
import { parseReport } from '../packages/core/dist/index.js';

const report = parseReport(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const archive = report.apps[0]?.archives?.[0];
const failures = [];
if (archive === undefined) failures.push('no archive in the report');
else {
  const categories = new Map(archive.categories.map((c) => [c.category, c]));
  for (const required of ['dex', 'native', 'resources', 'js-bundle']) {
    if ((categories.get(required)?.compressed ?? 0) <= 0)
      failures.push(`category ${required} is missing or empty`);
  }
  const total = archive.categories.reduce((sum, c) => sum + c.compressed, 0);
  if (total > archive.fileSize)
    failures.push(`categories (${total}) exceed the file size (${archive.fileSize})`);
  if (!archive.entries.some((e) => e.path === 'assets/index.android.bundle'))
    failures.push('no assets/index.android.bundle entry');
}
if (failures.length > 0) {
  process.stderr.write(`archive check failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `archive check passed: ${archive.file}, ${archive.entryCount} entries, ${archive.fileSize} bytes\n`,
);
