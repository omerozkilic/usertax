import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesGlob } from '@usertax/core';

describe('matchesGlob', () => {
  it('matches literally without wildcards', () => {
    expect(matchesGlob('js.total.gzip', 'js.total.gzip')).toBe(true);
    expect(matchesGlob('js.total.gzip', 'js.total.brotli')).toBe(false);
    expect(matchesGlob('jsXtotal.gzip', 'js.total.gzip')).toBe(false);
  });

  it('treats * as any sequence, including dots, slashes and brackets', () => {
    expect(matchesGlob('route[/pricing/plans].js.gzip', 'route[*].js.gzip')).toBe(true);
    expect(matchesGlob('route[/].js.brotli', 'route[*].js.gzip')).toBe(false);
    expect(matchesGlob('anything', '*')).toBe(true);
  });

  it('treats ? as exactly one character', () => {
    expect(matchesGlob('app1', 'app?')).toBe(true);
    expect(matchesGlob('app12', 'app?')).toBe(false);
  });

  it('escapes regular expression syntax', () => {
    expect(globToRegExp('a+b(c)|d').test('a+b(c)|d')).toBe(true);
    expect(globToRegExp('a+b').test('aab')).toBe(false);
  });
});
