/**
 * Escaping for strings that come from reports. Reports can be produced by untrusted PR code
 * (ADR 0005), so nothing taken from a report may inject Markdown, HTML, links, mentions or
 * hidden comment markers into a PR comment.
 */

const DEFAULT_MAX_LENGTH = 120;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

function clean(text: string, maxLength: number): string {
  const single = text.replace(/\r\n|\r|\n|\t/g, ' ').replace(CONTROL, '');
  const graphemes = Array.from(segmenter.segment(single), (part) => part.segment);
  return graphemes.length > maxLength ? `${graphemes.slice(0, maxLength - 1).join('')}…` : single;
}

/**
 * Escapes text for use in Markdown prose or a table cell. Markdown punctuation is
 * backslash-escaped and `@` is followed by a word joiner so it cannot mention anyone.
 */
export function escapeText(text: string, maxLength = DEFAULT_MAX_LENGTH): string {
  return clean(text, maxLength)
    .replace(/[\\`*_{}[\]()<>#+\-.!|~:&]/g, '\\$&')
    .replace(/@/g, '@\u2060');
}

/**
 * Renders text as an inline code span. Code spans disable Markdown, HTML, autolinks and
 * mentions. Backticks are replaced because GitHub tables do not support escaping them, and `|`
 * is escaped when the span is inside a table cell.
 */
export function inlineCode(
  text: string,
  options: { table?: boolean; maxLength?: number } = {},
): string {
  let content = clean(text, options.maxLength ?? DEFAULT_MAX_LENGTH).replace(/`/g, "'");
  if (options.table ?? true) content = content.replace(/\|/g, '\\|');
  if (content.trim() === '') content = ' ';
  return `\`${content}\``;
}
