import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReport } from '@usertax/core';
import type { Report } from '@usertax/core';
import { readZipFile } from '@usertax/measure';
import type { GitHub } from './github.js';

export const BASE_ARTIFACT_PREFIX = 'usertax-base-';
export const REPORT_FILE = 'usertax-report.json';

/** The commit a PR branched from, according to GitHub's compare API. */
export async function mergeBase(gh: GitHub, baseRef: string, headSha: string): Promise<string> {
  const compare = await gh.request<{ merge_base_commit: { sha: string } }>(
    'GET',
    `/repos/{owner}/{repo}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headSha)}`,
  );
  return compare.merge_base_commit.sha;
}

export type BaseLookup =
  | { readonly found: true; readonly report: Report; readonly sha: string; readonly behind: number }
  | { readonly found: false; readonly searched: number };

interface ArtifactList {
  artifacts: { id: number; name: string; expired: boolean }[];
}

/**
 * Finds the base report stored for `sha` by the push workflow on the default branch, or for one
 * of its `maxAncestors` nearest ancestors (ADR 0004). The report is validated before use.
 */
export async function findBaseReport(
  gh: GitHub,
  sha: string,
  maxAncestors = 20,
): Promise<BaseLookup> {
  const commits = await gh.request<{ sha: string }[]>(
    'GET',
    `/repos/{owner}/{repo}/commits?sha=${encodeURIComponent(sha)}&per_page=${maxAncestors + 1}`,
  );
  const shas = commits.length > 0 ? commits.map((c) => c.sha) : [sha];
  for (const [behind, candidate] of shas.entries()) {
    const list = await gh.request<ArtifactList>(
      'GET',
      `/repos/{owner}/{repo}/actions/artifacts?name=${BASE_ARTIFACT_PREFIX}${candidate}&per_page=5`,
    );
    const artifact = list.artifacts.find(
      (a) => !a.expired && a.name === `${BASE_ARTIFACT_PREFIX}${candidate}`,
    );
    if (artifact === undefined) continue;
    const dir = await mkdtemp(join(tmpdir(), 'usertax-base-'));
    try {
      const zip = join(dir, 'artifact.zip');
      await writeFile(zip, await gh.downloadArtifact(artifact.id));
      const report = parseReport(
        JSON.parse((await readZipFile(zip, REPORT_FILE)).toString('utf8')),
      );
      return { found: true, report, sha: candidate, behind };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { found: false, searched: shas.length };
}
