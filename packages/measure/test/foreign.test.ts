import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foreignSources } from '@usertax/measure';

describe('foreignSources', () => {
  it('flags sources outside the app that are missing or outside the repository', async () => {
    // repo/apps/web is the app; repo/packages/ui/src/Button.tsx is a workspace package.
    const repo = await mkdtemp(join(tmpdir(), 'usertax-foreign-'));
    const app = join(repo, 'apps', 'web');
    await mkdir(join(repo, 'packages', 'ui', 'src'), { recursive: true });
    await mkdir(app, { recursive: true });
    await writeFile(join(repo, 'packages', 'ui', 'src', 'Button.tsx'), '');
    const map = {
      version: 3,
      mappings: '',
      sources: [
        'webpack://_N_E/./app/page.tsx',
        'webpack://_N_E/../../packages/ui/src/Button.tsx',
        'webpack://_N_E/../../src/client/index.tsx',
        'webpack://_N_E/../../../src/shared/lib/utils.ts',
        'webpack://_N_E/../../node_modules/react/index.js',
        'webpack://_N_E/webpack/bootstrap',
        null,
      ],
    };
    const isForeign = await foreignSources(map, '.next/static/chunks', app, 'apps/web');
    expect(isForeign('app/page.tsx')).toBe(false);
    expect(isForeign('../../packages/ui/src/Button.tsx')).toBe(false);
    expect(isForeign('../../src/client/index.tsx')).toBe(true); // missing on disk
    expect(isForeign('../../../src/shared/lib/utils.ts')).toBe(true); // above the repository
    expect(isForeign('node_modules/react/index.js')).toBe(false);
    expect(isForeign('(virtual) webpack/bootstrap')).toBe(false);

    // Without the app's path in the repository, only missing files are foreign.
    const unknownRoot = await foreignSources(map, '.next/static/chunks', app, undefined);
    expect(unknownRoot('../../packages/ui/src/Button.tsx')).toBe(false);
    expect(unknownRoot('../../src/client/index.tsx')).toBe(true);
  });
});
