/**
 * Stable keys for hashed output files, so `assets/main-DOR0Mk0h.js` in the base and
 * `assets/main-Xy12ab9Q.js` in the head are compared as the same asset.
 *
 * Bundlers append a content hash to the file name. We replace the last name segment that looks
 * like a hash with `[hash]`:
 *
 * - 8 characters of `[A-Za-z0-9_-]` after a `-` or `.` (Vite / Rollup / Rolldown default) that
 *   contain a digit, `_`, `-`, or both upper- and lower-case letters. A random 8-character
 *   base64url hash fails this only when it is all lower-case or all upper-case letters,
 *   2 × (26/64)^8 ≈ 0.15 % of the time; such a file keeps its full name as key.
 * - 16 to 64 lower-case hex characters containing a digit (webpack, Next.js), either after a
 *   `-` or `.` or as the whole name, and 10 to 15 after a `.` or `-` (Rsbuild's default
 *   `[contenthash:10]`).
 *
 * Real names that happen to match (e.g. `user-Settings.js`) also get `[hash]`; that is harmless
 * because the replacement is stable between builds.
 */
const EXTENSION = /(\.[A-Za-z0-9]+)$/;

function isBase64UrlHash(segment: string): boolean {
  if (!/^[A-Za-z0-9_-]{8}$/.test(segment) || /^\d+$/.test(segment)) return false;
  return /[\d_-]/.test(segment) || (/[a-z]/.test(segment) && /[A-Z]/.test(segment));
}

function isHexHash(segment: string, min = 16): boolean {
  return segment.length >= min && /^[0-9a-f]{10,64}$/.test(segment) && /\d/.test(segment);
}

export function stableKey(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const base = path.slice(slash + 1);
  const extension = EXTENSION.exec(base)?.[1];
  if (extension === undefined) return path;
  const stem = base.slice(0, -extension.length);
  if (isHexHash(stem)) return `${dir}[hash]${extension}`;
  const hex = /^(.*[-.])([0-9a-f]{10,64})$/.exec(stem);
  if (hex?.[2] !== undefined && isHexHash(hex[2], 10)) {
    return `${dir}${hex[1] ?? ''}[hash]${extension}`;
  }
  const prefix = stem.slice(0, -9);
  const separator = stem.at(-9);
  const candidate = stem.slice(-8);
  if (prefix !== '' && (separator === '-' || separator === '.') && isBase64UrlHash(candidate)) {
    return `${dir}${prefix}${separator}[hash]${extension}`;
  }
  return path;
}

/**
 * Assigns unique keys. Files whose stable keys collide (for example several pure-hash chunk
 * names) get `~2`, `~3`, … in order of decreasing size, which keeps the assignment
 * deterministic but approximate; framework adapters with route manifests avoid this.
 */
export function assignKeys(files: readonly { path: string; size: number }[]): Map<string, string> {
  const groups = new Map<string, { path: string; size: number }[]>();
  for (const file of files) {
    const key = stableKey(file.path);
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }
  const keys = new Map<string, string>();
  for (const [key, group] of groups) {
    group.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
    group.forEach((file, index) => keys.set(file.path, index === 0 ? key : `${key}~${index + 1}`));
  }
  return keys;
}
