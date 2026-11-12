import { describe, expect, it } from 'vitest';
import { assignKeys, stableKey } from '@usertax/measure';

describe('stableKey', () => {
  it.each([
    ['assets/main-DOR0Mk0h.js', 'assets/main-[hash].js'],
    ['assets/styles-SChyrMlz.js', 'assets/styles-[hash].js'],
    ['assets/styles-dKSMzMgP.css', 'assets/styles-[hash].css'],
    ['assets/x-ab_cd-ef.js', 'assets/x-[hash].js'],
    ['static/chunks/app/page-0a1b2c3d4e5f6a7b.js', 'static/chunks/app/page-[hash].js'],
    ['main.3f9a8b7c6d5e4f3a2b1c.js', 'main.[hash].js'],
    ['static/chunks/0a1b2c3d4e5f6789.js', 'static/chunks/[hash].js'],
    // Rsbuild: [contenthash:10]
    ['static/js/index.b2a182c209.js', 'static/js/index.[hash].js'],
    ['static/js/async/u.1ce0f2e6ec.js', 'static/js/async/u.[hash].js'],
    ['static/css/index.9fca4abe73.css', 'static/css/index.[hash].css'],
  ])('replaces the hash in %s', (input, expected) => {
    expect(stableKey(input)).toBe(expected);
  });

  it.each([
    'index.html',
    'about/index.html',
    'assets/react-dom.js',
    'assets/vendor-abcdefgh.js', // all lower-case letters: indistinguishable from a word
    'assets/build-12345678.js', // only digits: likely a version or date
    'static/chunks/abcdefabcdefabcd.js', // hex-like but no digit
    'static/js/index.decafbadce.js', // ten hex letters, no digit
    'static/chunks/0a1b2c3d4e.js', // ten hex characters as the whole name: too short
    'favicon.ico',
  ])('keeps %s', (input) => {
    expect(stableKey(input)).toBe(input);
  });
});

describe('assignKeys', () => {
  it('disambiguates collisions by decreasing size', () => {
    const keys = assignKeys([
      { path: 'c/0a1b2c3d4e5f6789.js', size: 10 },
      { path: 'c/1a1b2c3d4e5f6789.js', size: 30 },
      { path: 'c/2a1b2c3d4e5f6789.js', size: 30 },
      { path: 'index.html', size: 5 },
    ]);
    expect(Object.fromEntries(keys)).toEqual({
      'c/1a1b2c3d4e5f6789.js': 'c/[hash].js',
      'c/2a1b2c3d4e5f6789.js': 'c/[hash].js~2',
      'c/0a1b2c3d4e5f6789.js': 'c/[hash].js~3',
      'index.html': 'index.html',
    });
  });
});
