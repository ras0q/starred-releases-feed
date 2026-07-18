import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { renderAtom } from "./src/atom.ts";
import { loadConfig } from "./src/config.ts";
import { groupReleasesByRepo } from "./src/feed-content.ts";
import { splitRepo } from "./src/github/graphql.ts";
import { renderHtmlPage } from "./src/html-page.ts";
import { syncStarredReleases } from "./main.ts";
import { runScan, scanLimits } from "./src/scan.ts";
import {
  emptyState,
  loadState,
  mergeReleases,
  pruneFeed,
  type ReleaseRecord,
  sealPastDays,
} from "./src/state.ts";

const renderOptions = {
  feedUrl: "https://example.test/starred-releases.atom",
  htmlUrl: "https://example.test/starred-releases.html",
  title: "Starred repository releases",
  subtitle: "Daily releases",
  authorName: "ras0q",
  authorUri: "https://github.com/ras0q",
  retentionDays: 7,
  updatedAt: new Date("2026-07-18T00:00:00.000Z"),
};

Deno.test("splitRepo parses owner and repository name", () => {
  assertEquals(splitRepo("denoland/deno"), ["denoland", "deno"]);
  assertThrows(() => splitRepo("invalid"));
});

Deno.test("loadConfig requires a token", () => {
  assertThrows(() => loadConfig({}, {}));
  assertEquals(loadConfig({ token: "pat" }, {}).token, "pat");
});

Deno.test("loadConfig derives htmlUrl from feedUrl by default", () => {
  const config = loadConfig({
    token: "pat",
    feedUrl: "https://example.test/starred-releases.atom",
  }, {});
  assertEquals(config.htmlUrl, "https://example.test/starred-releases.html");
});

Deno.test("mergeReleases deduplicates by release id and skips sealed days", () => {
  const state = emptyState();
  state.feed.sealedDates = ["2026-07-15"];
  state.feed.days["2026-07-15"] = [{
    id: "old",
    owner: "a",
    repo: "b",
    tag: "v1",
    url: "https://example.test/old",
    publishedAt: "2026-07-15T12:00:00.000Z",
  }];

  const release: ReleaseRecord = {
    id: "one",
    owner: "denoland",
    repo: "deno",
    tag: "v2.0.0",
    url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
    publishedAt: "2026-07-17T10:00:00.000Z",
  };

  mergeReleases(state, [release, release]);
  assertEquals(state.feed.days["2026-07-17"]?.length, 1);
  assertEquals(state.feed.days["2026-07-15"]?.[0].id, "old");
});

Deno.test("sealPastDays seals every day before today in UTC", () => {
  const state = emptyState();
  state.feed.days["2026-07-16"] = [];
  state.feed.days["2026-07-17"] = [];
  state.feed.days["2026-07-18"] = [];

  sealPastDays(state, new Date("2026-07-18T01:00:00.000Z"));
  assertEquals(state.feed.sealedDates, ["2026-07-16", "2026-07-17"]);
});

Deno.test("pruneFeed keeps only the newest sealed days", () => {
  const state = emptyState();
  state.feed.sealedDates = ["2026-07-10", "2026-07-11", "2026-07-12"];
  for (const date of state.feed.sealedDates) {
    state.feed.days[date] = [];
  }
  state.feed.days["2026-07-18"] = [];

  pruneFeed(state, 2);
  assertEquals(state.feed.sealedDates, ["2026-07-11", "2026-07-12"]);
  assertEquals(state.feed.days["2026-07-10"], undefined);
  assertEquals(state.feed.days["2026-07-18"]?.length, 0);
});

Deno.test("renderAtom emits descriptive titles, author, and html links", () => {
  const state = emptyState();
  state.feed.sealedDates = ["2026-07-17"];
  state.feed.days["2026-07-17"] = [{
    id: "one",
    owner: "denoland",
    repo: "deno",
    tag: "v2.0.0",
    url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
    publishedAt: "2026-07-17T10:00:00.000Z",
  }];

  const atom = renderAtom(state, renderOptions);

  assertEquals(
    atom.includes('<feed xmlns="http://www.w3.org/2005/Atom">'),
    true,
  );
  assertEquals(
    atom.includes("tag:github.com,2008:starred-releases:2026-07-17"),
    true,
  );
  assertEquals(
    atom.includes(
      "Starred releases on 2026-07-17 (1 release from 1 repository)",
    ),
    true,
  );
  assertEquals(atom.includes("<name>ras0q</name>"), true);
  assertEquals(atom.includes("https://github.com/ras0q"), true);
  assertEquals(
    atom.includes(
      'href="https://example.test/starred-releases.html#2026-07-17"',
    ),
    true,
  );
  assertEquals(atom.includes("denoland/deno (1 release)"), true);
  assertEquals(atom.includes("v2.0.0"), true);
});

Deno.test("formatDayContent groups releases under each repository", () => {
  const state = emptyState();
  state.feed.sealedDates = ["2026-07-17"];
  state.feed.days["2026-07-17"] = [
    {
      id: "two",
      owner: "yamcodes",
      repo: "arkenv",
      tag: "@arkenv/nuxt@0.0.6",
      url: "https://github.com/yamcodes/arkenv/releases/tag/@arkenv/nuxt@0.0.6",
      publishedAt: "2026-07-17T10:00:00.000Z",
    },
    {
      id: "one",
      owner: "denoland",
      repo: "deno",
      tag: "v2.0.0",
      url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
      publishedAt: "2026-07-17T09:00:00.000Z",
    },
    {
      id: "three",
      owner: "denoland",
      repo: "deno",
      tag: "v2.0.1",
      url: "https://github.com/denoland/deno/releases/tag/v2.0.1",
      publishedAt: "2026-07-17T11:00:00.000Z",
    },
  ];

  const atom = renderAtom(state, renderOptions);

  assertEquals(
    groupReleasesByRepo(state.feed.days["2026-07-17"]).map((group) =>
      group.key
    ),
    ["denoland/deno", "yamcodes/arkenv"],
  );
  assertEquals(
    atom.includes(
      "Starred releases on 2026-07-17 (3 releases from 2 repositories)",
    ),
    true,
  );
  assertEquals(atom.includes("denoland/deno (2 releases)"), true);
  assertEquals(atom.includes("yamcodes/arkenv (1 release)"), true);
  assertEquals(atom.includes("v2.0.1"), true);
  assertEquals(atom.includes("@arkenv/nuxt@0.0.6"), true);
  assertEquals(atom.includes("denoland/deno@v2.0.0"), false);
});

Deno.test("renderHtmlPage mirrors sealed days and includes run status", () => {
  const state = emptyState();
  state.feed.sealedDates = ["2026-07-16", "2026-07-17"];
  state.feed.days["2026-07-16"] = [];
  state.feed.days["2026-07-17"] = [{
    id: "one",
    owner: "denoland",
    repo: "deno",
    tag: "v2.0.0",
    url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
    publishedAt: "2026-07-17T10:00:00.000Z",
  }];

  const html = renderHtmlPage(state, {
    ...renderOptions,
    run: {
      stoppedBecause: "complete",
      releaseCount: 1,
      sealedDays: 2,
      durationMs: 1500,
      generatedAt: new Date("2026-07-18T00:00:00.000Z"),
    },
  });

  assertEquals(html.includes('id="status"'), true);
  assertEquals(html.includes("Stopped because"), true);
  assertEquals(html.includes("complete"), true);
  assertEquals(html.includes("1.5 s"), true);
  assertEquals(html.includes('id="2026-07-17"'), true);
  assertEquals(html.includes('id="2026-07-16"'), true);
  assertEquals(
    html.indexOf('id="2026-07-17"') < html.indexOf('id="2026-07-16"'),
    true,
  );
  assertEquals(
    html.includes("Starred releases on 2026-07-16 (no releases)"),
    true,
  );
});

Deno.test("runScan checkpoints starred pagination and resumes phase 2", async () => {
  const state = emptyState();
  const config = testConfig();
  let starredCalls = 0;
  let releaseCalls = 0;

  const first = await runScan(
    state,
    config,
    scanLimits(config, Date.now()),
    {
      fetch: (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          query: string;
        };
        if (body.query.includes("StarredRepos")) {
          starredCalls++;
          return Promise.resolve(githubGraphqlResponse({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                edges: [{
                  node: {
                    nameWithOwner: "denoland/deno",
                    releases: {
                      nodes: [{
                        id: "rel-1",
                        tagName: "v2.0.0",
                        name: "Deno 2",
                        isDraft: false,
                        isPrerelease: false,
                        publishedAt: "2026-07-17T10:00:00.000Z",
                        url:
                          "https://github.com/denoland/deno/releases/tag/v2.0.0",
                      }],
                    },
                  },
                }],
              },
            },
            rateLimit: {
              remaining: 50,
              resetAt: "2026-07-18T01:00:00Z",
            },
          }));
        }
        releaseCalls++;
        return Promise.resolve(githubGraphqlResponse({
          repository: {
            releases: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{
                id: "rel-1",
                tagName: "v2.0.0",
                name: "Deno 2",
                isDraft: false,
                isPrerelease: false,
                publishedAt: "2026-07-17T10:00:00.000Z",
                url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
              }],
            },
          },
          rateLimit: { remaining: 3_999, resetAt: "2026-07-18T01:00:00Z" },
        }));
      },
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    },
  );

  assertEquals(starredCalls, 1);
  assertEquals(releaseCalls, 0);
  assertEquals(state.scan.starredCursor, "cursor-1");
  assertEquals(state.scan.starredComplete, false);
  assertEquals(first.stoppedBecause, "rate-limit");
  assertEquals(first.releases.length, 0);

  const second = await runScan(
    state,
    config,
    scanLimits(config, Date.now()),
    {
      fetch: (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes("StarredRepos")) {
          starredCalls++;
          return Promise.resolve(githubGraphqlResponse({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [],
              },
            },
            rateLimit: {
              remaining: 4_000,
              resetAt: "2026-07-18T01:00:00Z",
            },
          }));
        }
        releaseCalls++;
        return Promise.resolve(githubGraphqlResponse({
          repository: {
            releases: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{
                id: "rel-1",
                tagName: "v2.0.0",
                name: "Deno 2",
                isDraft: false,
                isPrerelease: false,
                publishedAt: "2026-07-17T10:00:00.000Z",
                url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
              }],
            },
          },
          rateLimit: { remaining: 3_999, resetAt: "2026-07-18T01:00:00Z" },
        }));
      },
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    },
  );

  assertEquals(starredCalls, 2);
  assertEquals(releaseCalls, 1);
  assertEquals(second.releases.length, 1);
  assertEquals(state.scan.starredComplete, true);
});

Deno.test("runScan excludes draft and prerelease releases by default", async () => {
  const state = emptyState();
  const config = testConfig();

  const result = await runScan(
    state,
    { ...config, pageSize: 10 },
    scanLimits(config, Date.now()),
    {
      fetch: (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes("StarredRepos")) {
          return Promise.resolve(githubGraphqlResponse({
            viewer: {
              starredRepositories: {
                pageInfo: { hasNextPage: false, endCursor: null },
                edges: [{
                  node: {
                    nameWithOwner: "acme/app",
                    releases: {
                      nodes: [{
                        id: "latest",
                        tagName: "v1.0.0",
                        name: null,
                        isDraft: false,
                        isPrerelease: false,
                        publishedAt: "2026-07-17T10:00:00.000Z",
                        url: "https://github.com/acme/app/releases/tag/v1.0.0",
                      }],
                    },
                  },
                }],
              },
            },
            rateLimit: {
              remaining: 4_000,
              resetAt: "2026-07-18T01:00:00Z",
            },
          }));
        }
        return Promise.resolve(githubGraphqlResponse({
          repository: {
            releases: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: "draft",
                  tagName: "v0.9.0",
                  name: null,
                  isDraft: true,
                  isPrerelease: false,
                  publishedAt: "2026-07-17T09:00:00.000Z",
                  url: "https://github.com/acme/app/releases/tag/v0.9.0",
                },
                {
                  id: "pre",
                  tagName: "v1.0.0-rc1",
                  name: null,
                  isDraft: false,
                  isPrerelease: true,
                  publishedAt: "2026-07-17T08:00:00.000Z",
                  url: "https://github.com/acme/app/releases/tag/v1.0.0-rc1",
                },
                {
                  id: "stable",
                  tagName: "v1.0.0",
                  name: null,
                  isDraft: false,
                  isPrerelease: false,
                  publishedAt: "2026-07-17T10:00:00.000Z",
                  url: "https://github.com/acme/app/releases/tag/v1.0.0",
                },
              ],
            },
          },
          rateLimit: { remaining: 3_999, resetAt: "2026-07-18T01:00:00Z" },
        }));
      },
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    },
  );

  assertEquals(result.releases.map((release) => release.id), ["stable"]);
});

Deno.test("syncStarredReleases writes atom, html, and state when persisting", async () => {
  const directory = await Deno.makeTempDir();
  const config = testConfig({
    statePath: `${directory}/state.json`,
    feedPath: `${directory}/starred-releases.atom`,
    htmlPath: `${directory}/starred-releases.html`,
  });

  await syncStarredReleases(config, {
    fetch: mockGithubFetch(),
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });

  const state = await loadState(config.statePath);
  assertEquals(state.feed.sealedDates.includes("2026-07-17"), true);
  const atom = await Deno.readTextFile(config.feedPath);
  const html = await Deno.readTextFile(config.htmlPath);
  assertEquals(atom.includes("denoland/deno (1 release)"), true);
  assertEquals(atom.includes("v2.0.0"), true);
  assertEquals(html.includes('id="2026-07-17"'), true);
  assertEquals(html.includes("Latest run"), true);
});

Deno.test("state rejects malformed cache data", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/state.json`;
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      feed: { sealedDates: [], days: {} },
      scan: { repos: "bad" },
    }),
  );

  await assertRejects(() => loadState(path));
});

function testConfig(overrides: Partial<ReturnType<typeof loadConfig>> = {}) {
  return loadConfig({
    token: "test-token",
    statePath: "state.json",
    feedPath: "starred-releases.atom",
    feedUrl: "https://example.test/starred-releases.atom",
    htmlPath: "starred-releases.html",
    htmlUrl: "https://example.test/starred-releases.html",
    authorName: "ras0q",
    maxRuntimeMinutes: 10,
    minRemainingPoints: 100,
    overlapMs: 86_400_000,
    feedRetentionDays: 7,
    includePrereleases: false,
    includeDrafts: false,
    pageSize: 50,
    ...overrides,
  });
}

function githubGraphqlResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function mockGithubFetch(): typeof fetch {
  return (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    if (body.query.includes("StarredRepos")) {
      return Promise.resolve(githubGraphqlResponse({
        viewer: {
          starredRepositories: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{
              node: {
                nameWithOwner: "denoland/deno",
                releases: {
                  nodes: [{
                    id: "rel-1",
                    tagName: "v2.0.0",
                    name: "Deno 2",
                    isDraft: false,
                    isPrerelease: false,
                    publishedAt: "2026-07-17T10:00:00.000Z",
                    url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
                  }],
                },
              },
            }],
          },
        },
        rateLimit: { remaining: 4_000, resetAt: "2026-07-18T01:00:00Z" },
      }));
    }
    return Promise.resolve(githubGraphqlResponse({
      repository: {
        releases: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{
            id: "rel-1",
            tagName: "v2.0.0",
            name: "Deno 2",
            isDraft: false,
            isPrerelease: false,
            publishedAt: "2026-07-17T10:00:00.000Z",
            url: "https://github.com/denoland/deno/releases/tag/v2.0.0",
          }],
        },
      },
      rateLimit: { remaining: 3_999, resetAt: "2026-07-18T01:00:00Z" },
    }));
  };
}
