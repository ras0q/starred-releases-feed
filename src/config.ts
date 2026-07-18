export type Config = {
  token: string;
  statePath: string;
  feedPath: string;
  feedUrl: string;
  htmlPath: string;
  htmlUrl: string;
  authorName: string;
  authorUri?: string;
  maxRuntimeMinutes: number;
  minRemainingPoints: number;
  overlapMs: number;
  feedRetentionDays: number;
  includePrereleases: boolean;
  includeDrafts: boolean;
  pageSize: number;
};

const DEFAULTS = {
  maxRuntimeMinutes: 10,
  minRemainingPoints: 100,
  overlapMs: 86_400_000,
  feedRetentionDays: 7,
  pageSize: 50,
} as const;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function defaultHtmlUrl(feedUrl: string): string {
  return feedUrl.replace(/\.atom$/, ".html");
}

/**
 * Loads runtime configuration from environment variables and optional overrides.
 */
export function loadConfig(
  overrides: Partial<Config> = {},
  env: Record<string, string | undefined> = globalThis.Deno?.env.toObject?.() ??
    {},
): Config {
  const token = overrides.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN ?? "";
  if (!token) {
    throw new Error("GITHUB_TOKEN (or GH_TOKEN) is required");
  }

  const feedUrl = overrides.feedUrl ?? env.FEED_URL ??
    "https://example.github.io/starred-releases.atom";

  return {
    token,
    statePath: overrides.statePath ?? env.STATE_PATH ?? "state.json",
    feedPath: overrides.feedPath ?? env.FEED_PATH ?? "starred-releases.atom",
    feedUrl,
    htmlPath: overrides.htmlPath ?? env.HTML_PATH ?? "starred-releases.html",
    htmlUrl: overrides.htmlUrl ?? env.HTML_URL ?? defaultHtmlUrl(feedUrl),
    authorName: overrides.authorName ?? env.AUTHOR_NAME ?? "ras0q",
    authorUri: overrides.authorUri ?? env.AUTHOR_URI,
    maxRuntimeMinutes: overrides.maxRuntimeMinutes ??
      parsePositiveInt(env.MAX_RUNTIME_MINUTES, DEFAULTS.maxRuntimeMinutes),
    minRemainingPoints: overrides.minRemainingPoints ??
      parsePositiveInt(env.MIN_REMAINING_POINTS, DEFAULTS.minRemainingPoints),
    overlapMs: overrides.overlapMs ??
      parsePositiveInt(env.OVERLAP_MS, DEFAULTS.overlapMs),
    feedRetentionDays: overrides.feedRetentionDays ??
      parsePositiveInt(env.FEED_RETENTION_DAYS, DEFAULTS.feedRetentionDays),
    includePrereleases: overrides.includePrereleases ??
      parseBoolean(env.INCLUDE_PRERELEASES, false),
    includeDrafts: overrides.includeDrafts ??
      parseBoolean(env.INCLUDE_DRAFTS, false),
    pageSize: overrides.pageSize ??
      parsePositiveInt(env.PAGE_SIZE, DEFAULTS.pageSize),
  };
}
