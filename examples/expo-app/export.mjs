// `expo export --platform all` builds both platforms in parallel, and its Hermes bundles are not
// byte-for-byte reproducible: in 4 runs it produced 2 different pairs of bundles for the same
// code (docs/metrics.md). Each platform exported on its own is reproducible, so this exports
// Android into dist/ and adds the iOS bundle next to it, where usertax looks for both.
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';

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
rmSync('.dist-ios', { recursive: true, force: true });
