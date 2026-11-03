export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Repo {
  readonly owner: string;
  readonly repo: string;
}

/** A minimal GitHub REST client over fetch (no dependencies in the action bundle). */
export class GitHub {
  constructor(
    private readonly token: string,
    readonly repository: Repo,
    private readonly fetchFn: typeof fetch,
    private readonly apiUrl = 'https://api.github.com',
  ) {}

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'usertax-action',
    };
  }

  /** `path` may contain `{owner}` and `{repo}`. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.apiUrl}${path.replace('{owner}', encodeURIComponent(this.repository.owner)).replace('{repo}', encodeURIComponent(this.repository.repo))}`;
    const response = await this.fetchFn(url, {
      method,
      headers: {
        ...this.headers(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new GitHubError(
        `GitHub API ${method} ${path} failed with ${response.status}`,
        response.status,
      );
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  /** Follows `per_page` pagination up to `maxPages`. */
  async paginate<T>(path: string, pick: (page: unknown) => T[], maxPages = 10): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const batch = pick(
        await this.request<unknown>('GET', `${path}${separator}per_page=100&page=${page}`),
      );
      items.push(...batch);
      if (batch.length < 100) break;
    }
    return items;
  }

  /**
   * Downloads an artifact ZIP. The API answers with a redirect to blob storage, which must not
   * receive the token, so the redirect is followed by hand without credentials.
   */
  async downloadArtifact(id: number): Promise<Uint8Array> {
    const response = await this.fetchFn(
      `${this.apiUrl}/repos/${this.repository.owner}/${this.repository.repo}/actions/artifacts/${id}/zip`,
      {
        headers: this.headers(),
        redirect: 'manual',
      },
    );
    const location = response.headers.get('location');
    const blob =
      response.status >= 300 && response.status < 400 && location !== null
        ? await this.fetchFn(location)
        : response;
    if (!blob.ok)
      throw new GitHubError(`downloading artifact ${id} failed with ${blob.status}`, blob.status);
    return new Uint8Array(await blob.arrayBuffer());
  }
}
