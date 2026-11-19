// `expo export --platform all` builds both platforms in parallel, and its Hermes bundles are not
// byte-for-byte reproducible: in 4 runs it produced 2 different pairs of bundles for the same
// code (docs/metrics.md). Each platform exported on its own is reproducible, so this exports
// Android into dist/ and adds the iOS bundle, assets and metadata.json entry next to it, where
// usertax looks for both (the update size comes from metadata.json).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const expo = (platform, outputDir) =>
  execFileSync(
    'npx',
    ['expo', 'export', '--platform', platform, '--source-maps', '--output-dir', outputDir],
    { stdio: 'inherit' },
  );

rmSync('dist', { recursive: true, force: true });
expo('android', 'dist');
expo('ios', '.dist-ios');
cpSync('.dist-ios/_expo/static/js/ios', 'dist/_expo/static/js/ios', { recursive: true });
if (existsSync('.dist-ios/assets'))
  cpSync('.dist-ios/assets', 'dist/assets', { recursive: true, force: false });
const metadata = JSON.parse(readFileSync('dist/metadata.json', 'utf8'));
const ios = JSON.parse(readFileSync('.dist-ios/metadata.json', 'utf8'));
metadata.fileMetadata.ios = ios.fileMetadata.ios;
writeFileSync('dist/metadata.json', `${JSON.stringify(metadata)}\n`);
rmSync('.dist-ios', { recursive: true, force: true });
