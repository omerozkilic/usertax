/**
 * Minimal glob matching for app ids and metric ids: `*` matches any sequence of characters
 * (including `.`, `/` and brackets), `?` matches one character. Everything else, including `[` and
 * `]`, is literal, so `route[*].js.gzip` selects the gzip JS size of every route.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

export function matchesGlob(value: string, pattern: string): boolean {
  return globToRegExp(pattern).test(value);
}
