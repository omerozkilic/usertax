import { COMMENT_MARKER } from '@usertax/core';
import type { GitHub } from './github.js';

interface IssueComment {
  id: number;
  html_url: string;
  body?: string;
  user?: { type?: string };
}

/**
 * Creates or updates the sticky comment: the first comment by a bot (the token's identity with
 * the default GITHUB_TOKEN) whose body starts with the usertax marker.
 */
export async function upsertComment(
  gh: GitHub,
  number: number,
  body: string,
): Promise<{ url: string; created: boolean }> {
  const comments = await gh.paginate<IssueComment>(
    `/repos/{owner}/{repo}/issues/${number}/comments`,
    (page) => page as IssueComment[],
  );
  const existing = comments.find(
    (c) => c.user?.type === 'Bot' && c.body?.startsWith(COMMENT_MARKER) === true,
  );
  if (existing !== undefined) {
    const updated = await gh.request<IssueComment>(
      'PATCH',
      `/repos/{owner}/{repo}/issues/comments/${existing.id}`,
      { body },
    );
    return { url: updated.html_url, created: false };
  }
  const created = await gh.request<IssueComment>(
    'POST',
    `/repos/{owner}/{repo}/issues/${number}/comments`,
    { body },
  );
  return { url: created.html_url, created: true };
}
