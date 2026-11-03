import { describe, expect, it } from 'vitest';
import { escapeText, inlineCode } from '@usertax/core';

describe('escapeText', () => {
  it('escapes Markdown and HTML syntax', () => {
    expect(escapeText('**bold** [x](http://evil) <img src=x>')).toBe(
      '\\*\\*bold\\*\\* \\[x\\]\\(http\\://evil\\) \\<img src=x\\>',
    );
  });

  it('neutralises mentions', () => {
    expect(escapeText('@octocat')).toBe('@⁠octocat');
  });

  it('removes line breaks, control and invisible characters', () => {
    expect(escapeText('a\nb\r\nc\td\u0000e‮f​g')).toBe('a b c defg');
  });

  it('cannot inject a comment marker', () => {
    expect(escapeText('<!-- usertax:report -->')).not.toContain('<!--');
  });

  it('truncates by grapheme', () => {
    expect(escapeText('👍🏽'.repeat(5), 3)).toBe('👍🏽👍🏽…');
    expect(escapeText('short', 10)).toBe('short');
  });
});

describe('inlineCode', () => {
  it('wraps text in a code span and escapes table pipes', () => {
    expect(inlineCode('a|b')).toBe('`a\\|b`');
    expect(inlineCode('a|b', { table: false })).toBe('`a|b`');
  });

  it('replaces backticks so the span cannot be closed early', () => {
    expect(inlineCode('x` <b>y</b> `z')).toBe("`x' <b>y</b> 'z`");
  });

  it('keeps empty content renderable', () => {
    expect(inlineCode('\n')).toBe('` `');
  });

  it('truncates long text', () => {
    expect(inlineCode('abcdef', { maxLength: 4 })).toBe('`abc…`');
  });
});
