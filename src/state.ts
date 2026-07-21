import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";

export type ReleaseRecord = {
  id: string;
  owner: string;
  repo: string;
  tag: string;
  url: string;
  publishedAt: string;
  name?: string;
};

export type RepoScanState = {
  lastReleaseId?: string;
  lastPublishedAt?: string;
  /** Non-null while paginating release history for this repository. */
  releaseHistoryCursor?: string | null;
};

export type ScanState = {
  /** Non-null while paginating starred repositories; null means repoll from start. */
  starredPollCursor?: string | null;
  releaseHistoryQueue?: string[];
  releaseHistoryIndex?: number;
  repos: Record<string, RepoScanState>;
};

export type FeedState = {
  sealedDates: string[];
  days: Record<string, ReleaseRecord[]>;
};

export type AppState = {
  schemaVersion: 1;
  feed: FeedState;
  scan: ScanState;
};

/**
 * Parses persisted state with minimal structural checks. Nested records are trusted.
 */
function parseState(parsed: unknown): AppState {
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid state");

  const root = parsed as Record<string, unknown>;
  if (root.schemaVersion !== 1) throw new Error("Invalid state");

  const feed = root.feed;
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    throw new Error("Invalid state");
  }
  const feedObj = feed as Record<string, unknown>;
  if (!Array.isArray(feedObj.sealedDates)) throw new Error("Invalid state");
  if (
    !feedObj.days || typeof feedObj.days !== "object" ||
    Array.isArray(feedObj.days)
  ) {
    throw new Error("Invalid state");
  }

  const scan = parseScanState(root.scan);

  return {
    schemaVersion: 1,
    feed: feedObj as FeedState,
    scan,
  };
}

function parseScanState(raw: unknown): ScanState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid state");
  }

  const scan = raw as Record<string, unknown>;
  if (
    !scan.repos || typeof scan.repos !== "object" || Array.isArray(scan.repos)
  ) {
    throw new Error("Invalid state");
  }

  const repos: Record<string, RepoScanState> = {};
  for (const [nameWithOwner, repoRaw] of Object.entries(scan.repos)) {
    repos[nameWithOwner] = parseRepoScanState(repoRaw);
  }

  return {
    starredPollCursor: parseNullableString(scan.starredPollCursor),
    releaseHistoryQueue: parseStringArray(scan.releaseHistoryQueue),
    releaseHistoryIndex: parseOptionalIndex(scan.releaseHistoryIndex),
    repos,
  };
}

function parseRepoScanState(raw: unknown): RepoScanState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid state");
  }

  const repo = raw as Record<string, unknown>;
  return {
    lastReleaseId: parseOptionalString(repo.lastReleaseId),
    lastPublishedAt: parseOptionalString(repo.lastPublishedAt),
    releaseHistoryCursor: parseNullableString(repo.releaseHistoryCursor),
  };
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function parseOptionalIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((entry) => typeof entry === "string")) {
    throw new Error("Invalid state");
  }
  return value;
}

export function emptyState(): AppState {
  return {
    schemaVersion: 1,
    feed: { sealedDates: [], days: {} },
    scan: { repos: {} },
  };
}

export async function loadState(path: string): Promise<AppState> {
  try {
    const state = parseState(
      JSON.parse(await readFile(path, "utf8")) as unknown,
    );
    return state;
  } catch (error) {
    if (
      typeof error === "object" && error !== null && "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyState();
    }
    throw error;
  }
}

export async function saveState(path: string, state: AppState): Promise<void> {
  await mkdir(nodePath.dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Returns the UTC calendar date (YYYY-MM-DD) for an ISO timestamp.
 */
export function utcDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Returns today's UTC date as YYYY-MM-DD.
 */
export function utcToday(now = new Date()): string {
  return utcDate(now.toISOString());
}

/**
 * Merges release records into daily buckets, skipping duplicates by release id.
 * Sealed days are left unchanged.
 */
export function mergeReleases(
  state: AppState,
  releases: ReleaseRecord[],
): void {
  const sealed = new Set(state.feed.sealedDates);

  for (const release of releases) {
    const day = utcDate(release.publishedAt);
    if (sealed.has(day)) continue;

    const bucket = state.feed.days[day] ?? [];
    if (bucket.some((entry) => entry.id === release.id)) continue;
    bucket.push(release);
    bucket.sort(compareReleases);
    state.feed.days[day] = bucket;
  }
}

/**
 * Seals every day strictly before today (UTC). Sealed buckets stop accepting merges.
 */
export function sealPastDays(state: AppState, now = new Date()): void {
  const today = utcToday(now);
  const sealed = new Set(state.feed.sealedDates);

  for (const date of Object.keys(state.feed.days).sort()) {
    if (date >= today || sealed.has(date)) continue;
    sealed.add(date);
  }

  state.feed.sealedDates = [...sealed].sort();
}

/**
 * Removes sealed day buckets older than the retention window.
 * Unsealed buckets are always kept.
 */
export function pruneFeed(
  state: AppState,
  retentionDays: number,
): void {
  const sealed = [...state.feed.sealedDates].sort();
  if (sealed.length <= retentionDays) return;

  const drop = new Set(sealed.slice(0, sealed.length - retentionDays));
  state.feed.sealedDates = sealed.filter((date) => !drop.has(date));
  for (const date of drop) {
    delete state.feed.days[date];
  }
}

export function sealedFeedDays(
  state: AppState,
  retentionDays: number,
): string[] {
  return [...state.feed.sealedDates].sort().slice(-retentionDays);
}

/** Serializes feed buckets for change detection across sync runs. */
export function feedSnapshot(state: AppState): string {
  return JSON.stringify(state.feed);
}

function compareReleases(a: ReleaseRecord, b: ReleaseRecord): number {
  const byTime = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  if (byTime !== 0) return byTime;
  const byRepo = `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`);
  if (byRepo !== 0) return byRepo;
  return a.tag.localeCompare(b.tag);
}
