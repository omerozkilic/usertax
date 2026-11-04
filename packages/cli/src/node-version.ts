/**
 * The first release of each Node.js line with the October 2026 security fixes (CVE-2026-111497,
 * Brotli decoder; CVE-2026-105483 and CVE-2026-106069, TLS hostname validation; CVE-2026-105482,
 * DNS). Lines that are not listed are older than 22 or odd, unsupported releases (ADR 0010).
 */
const PATCHED: Readonly<Record<number, readonly [number, number]>> = {
  22: [23, 4],
  24: [22, 1],
  26: [12, 1],
};

/**
 * A warning for a Node.js runtime without those fixes, or undefined. `version` is
 * `process.version`, e.g. `v24.22.1`. Lines newer than 26 are assumed to include the fixes.
 */
export function nodeVersionWarning(version: string): string | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) return undefined;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (major > 26) return undefined;
  const fixed = PATCHED[major];
  const ok = fixed !== undefined && (minor > fixed[0] || (minor === fixed[0] && patch >= fixed[1]));
  if (ok) return undefined;
  return `usertax: warning: Node.js ${version} lacks the October 2026 security fixes (CVE-2026-111497 and others); use 22.23.4, 24.22.1, 26.12.1 or later.\n`;
}
