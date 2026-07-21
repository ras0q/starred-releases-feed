import { graphql } from "@octokit/graphql";

export type RateLimit = {
  remaining: number;
  resetAt: string;
};

export type GraphqlRelease = {
  id: string;
  tagName: string;
  name: string | null;
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string | null;
  url: string;
};

export type StarredRepoSnapshot = {
  nameWithOwner: string;
  latestRelease: GraphqlRelease | null;
};

export type StarredPage = {
  repos: StarredRepoSnapshot[];
  cursor: string | null;
  hasNextPage: boolean;
  rateLimit: RateLimit;
};

export type ReleasePage = {
  releases: GraphqlRelease[];
  cursor: string | null;
  hasNextPage: boolean;
  rateLimit: RateLimit;
};

export type GithubClient = {
  fetchStarredPage: (
    cursor: string | null,
    pageSize: number,
  ) => Promise<StarredPage>;
  fetchReleasePage: (
    nameWithOwner: string,
    cursor: string | null,
    pageSize: number,
  ) => Promise<ReleasePage>;
};

const STARRED_QUERY = `
query StarredRepos($cursor: String, $pageSize: Int!) {
  viewer {
    login
    starredRepositories(first: $pageSize, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          nameWithOwner
          releases(first: 5, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              id
              tagName
              name
              isDraft
              isPrerelease
              publishedAt
              url
            }
          }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}`;

const RELEASES_QUERY = `
query RepoReleases($owner: String!, $name: String!, $cursor: String, $pageSize: Int!) {
  repository(owner: $owner, name: $name) {
    releases(first: $pageSize, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        tagName
        name
        isDraft
        isPrerelease
        publishedAt
        url
      }
    }
  }
  rateLimit { remaining resetAt }
}`;

type StarredQueryResult = {
  viewer: {
    starredRepositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{
        node: {
          nameWithOwner: string;
          releases: { nodes: GraphqlRelease[] };
        };
      }>;
    };
  };
  rateLimit: RateLimit;
};

type ReleasesQueryResult = {
  repository: {
    releases: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphqlRelease[];
    };
  } | null;
  rateLimit: RateLimit;
};

/**
 * Creates a GitHub GraphQL client backed by the official @octokit/graphql package.
 */
export function createGithubClient(
  token: string,
  fetcher: typeof fetch = fetch,
): GithubClient {
  async function request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    return await graphql<T>(query, {
      ...variables,
      headers: {
        authorization: `Bearer ${token}`,
      },
      request: {
        fetch: fetcher,
      },
    });
  }

  return {
    async fetchStarredPage(cursor, pageSize) {
      const data = await request<StarredQueryResult>(STARRED_QUERY, {
        cursor,
        pageSize,
      });

      return {
        repos: data.viewer.starredRepositories.edges.map((edge) => ({
          nameWithOwner: edge.node.nameWithOwner,
          latestRelease: pickLatestRelease(edge.node.releases.nodes),
        })),
        cursor: data.viewer.starredRepositories.pageInfo.endCursor,
        hasNextPage: data.viewer.starredRepositories.pageInfo.hasNextPage,
        rateLimit: data.rateLimit,
      };
    },

    async fetchReleasePage(nameWithOwner, cursor, pageSize) {
      const [owner, name] = splitRepo(nameWithOwner);
      const data = await request<ReleasesQueryResult>(RELEASES_QUERY, {
        owner,
        name,
        cursor,
        pageSize,
      });

      if (!data.repository) {
        throw new Error(`Repository not found: ${nameWithOwner}`);
      }

      return {
        releases: data.repository.releases.nodes,
        cursor: data.repository.releases.pageInfo.endCursor,
        hasNextPage: data.repository.releases.pageInfo.hasNextPage,
        rateLimit: data.rateLimit,
      };
    },
  };
}

export function splitRepo(nameWithOwner: string): [string, string] {
  const index = nameWithOwner.indexOf("/");
  if (index <= 0 || index === nameWithOwner.length - 1) {
    throw new Error(`Invalid repository name: ${nameWithOwner}`);
  }
  return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
}

function pickLatestRelease(releases: GraphqlRelease[]): GraphqlRelease | null {
  for (const release of releases) {
    if (release.isDraft || release.isPrerelease || !release.publishedAt) {
      continue;
    }
    return release;
  }
  return null;
}
