import { describe, expect, it } from 'vitest';
import { nodeVersionWarning } from '@usertax/cli';

describe('nodeVersionWarning', () => {
  it.each(['v22.23.4', 'v22.24.0', 'v24.22.1', 'v24.23.0', 'v26.12.1', 'v27.0.0', 'v30.1.2'])(
    'accepts %s',
    (version) => {
      expect(nodeVersionWarning(version)).toBeUndefined();
    },
  );

  it.each([
    'v22.23.3',
    'v22.18.0',
    'v24.22.0',
    'v24.0.0',
    'v26.12.0',
    'v23.11.0',
    'v25.1.0',
    'v20.19.0',
  ])('warns about %s', (version) => {
    expect(nodeVersionWarning(version)).toContain(`Node.js ${version} lacks the October 2026`);
  });

  it('ignores versions it cannot parse', () => {
    expect(nodeVersionWarning('unknown')).toBeUndefined();
  });
});
