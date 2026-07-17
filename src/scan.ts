import type { Config } from "./config.ts";
import {
  createGithubClient,
  type GithubClient,
  type GraphqlRelease,
  splitRepo,
} from "./github/graphql.ts";
import type { AppState, ReleaseRecord } from "./state.ts";

export type ScanLimits = {
  startedAt: number;
  deadlineAt: number;
  minRemainingPoints: number;
};

export type ScanResult = {
  releases: ReleaseRecord[];
  stoppedBecause: "complete" | "time" | "rate-limit";
  rateLimitRemaining?: number;
};

type ScanDeps = {
  github?: GithubClient;
  fetch?: typeof fetch;
  now: () => Date;
};

/**
 * Runs the two-phase starred-repository scan until completion or a stop condition.
 */
export async function runScan(
  state: AppState,
  config: Config,
  limits: ScanLimits,
  deps: Partial<ScanDeps> = {},
): Promise<ScanResult> {
  const d: ScanDeps = { now: () => new Date(), ...deps };
  const github = d.github ??
    createGithubClient(config.token, d.fetch ?? fetch);
  const collected: ReleaseRecord[] = [];
  let stoppedBecause: ScanResult["stoppedBecause"] = "complete";
  let rateLimitRemaining: number | undefined;

  const windowStart = d.now().getTime() -
    config.feedRetentionDays * 86_400_000 -
    config.overlapMs;

  if (!state.scan.starredComplete) {
    let cursor = state.scan.starredCursor ?? null;
    while (true) {
      if (shouldStop(limits, rateLimitRemaining)) {
        stoppedBecause = limitsReason(limits, rateLimitRemaining);
        break;
      }

      const page = await github.fetchStarredPage(cursor, config.pageSize);
      rateLimitRemaining = page.rateLimit.remaining;

      for (const repo of page.repos) {
        rememberRepoSnapshot(
          state,
          config,
          repo.nameWithOwner,
          repo.latestRelease,
        );
        if (repoNeedsPhase2(repo.latestRelease, windowStart)) {
          enqueuePhase2(state, repo.nameWithOwner);
        }
      }

      cursor = page.cursor;
      state.scan.starredCursor = cursor;
      state.scan.starredComplete = !page.hasNextPage;
      if (!page.hasNextPage) break;
    }
  }

  const queue = state.scan.phase2Queue ?? [];
  let index = state.scan.phase2Index ?? 0;

  while (index < queue.length) {
    if (shouldStop(limits, rateLimitRemaining)) {
      stoppedBecause = limitsReason(limits, rateLimitRemaining);
      break;
    }

    const nameWithOwner = queue[index];
    const repoState = state.scan.repos[nameWithOwner] ?? {};
    state.scan.repos[nameWithOwner] = repoState;

    let cursor = repoState.releaseCursorComplete
      ? null
      : repoState.releaseCursor ?? null;
    let done = repoState.releaseCursorComplete ?? false;

    while (!done) {
      if (shouldStop(limits, rateLimitRemaining)) {
        stoppedBecause = limitsReason(limits, rateLimitRemaining);
        state.scan.phase2Index = index;
        state.scan.phase2Queue = queue;
        return { releases: collected, stoppedBecause, rateLimitRemaining };
      }

      const page = await github.fetchReleasePage(
        nameWithOwner,
        cursor,
        config.pageSize,
      );
      rateLimitRemaining = page.rateLimit.remaining;

      let hitOlder = false;
      for (const release of page.releases) {
        if (!acceptRelease(release, config)) continue;
        if (!release.publishedAt) continue;

        const record = toReleaseRecord(nameWithOwner, release);
        collected.push(record);
        updateHighWater(repoState, record);

        if (Date.parse(release.publishedAt) < windowStart) {
          hitOlder = true;
          break;
        }
      }

      cursor = page.cursor;
      repoState.releaseCursor = cursor;
      done = !page.hasNextPage || hitOlder;
      repoState.releaseCursorComplete = done;
    }

    index += 1;
    state.scan.phase2Index = index;
  }

  if (index >= queue.length) {
    state.scan.phase2Queue = [];
    state.scan.phase2Index = 0;
  } else {
    state.scan.phase2Queue = queue;
    state.scan.phase2Index = index;
  }

  return { releases: collected, stoppedBecause, rateLimitRemaining };
}

function shouldStop(
  limits: ScanLimits,
  rateLimitRemaining: number | undefined,
): boolean {
  if (Date.now() >= limits.deadlineAt) return true;
  if (
    rateLimitRemaining !== undefined &&
    rateLimitRemaining <= limits.minRemainingPoints
  ) {
    return true;
  }
  return false;
}

function limitsReason(
  limits: ScanLimits,
  rateLimitRemaining: number | undefined,
): ScanResult["stoppedBecause"] {
  if (Date.now() >= limits.deadlineAt) return "time";
  if (
    rateLimitRemaining !== undefined &&
    rateLimitRemaining <= limits.minRemainingPoints
  ) {
    return "rate-limit";
  }
  return "complete";
}

function acceptRelease(release: GraphqlRelease, config: Config): boolean {
  if (release.isDraft && !config.includeDrafts) return false;
  if (release.isPrerelease && !config.includePrereleases) return false;
  return Boolean(release.publishedAt);
}

function repoNeedsPhase2(
  latest: GraphqlRelease | null,
  windowStart: number,
): boolean {
  if (!latest?.publishedAt) return false;
  return Date.parse(latest.publishedAt) >= windowStart;
}

function enqueuePhase2(state: AppState, nameWithOwner: string): void {
  const queue = state.scan.phase2Queue ?? [];
  if (!queue.includes(nameWithOwner)) {
    queue.push(nameWithOwner);
  }
  state.scan.phase2Queue = queue;
}

function rememberRepoSnapshot(
  state: AppState,
  config: Config,
  nameWithOwner: string,
  latest: GraphqlRelease | null,
): void {
  const repoState = state.scan.repos[nameWithOwner] ?? {};
  if (latest?.publishedAt && acceptRelease(latest, config)) {
    const record = toReleaseRecord(nameWithOwner, latest);
    updateHighWater(repoState, record);
  }
  state.scan.repos[nameWithOwner] = repoState;
}

function updateHighWater(
  repoState: AppState["scan"]["repos"][string],
  release: ReleaseRecord,
): void {
  const current = repoState.lastPublishedAt
    ? Date.parse(repoState.lastPublishedAt)
    : 0;
  const incoming = Date.parse(release.publishedAt);
  if (incoming >= current) {
    repoState.lastPublishedAt = release.publishedAt;
    repoState.lastReleaseId = release.id;
  }
}

function toReleaseRecord(
  nameWithOwner: string,
  release: GraphqlRelease,
): ReleaseRecord {
  const [owner, repo] = splitRepo(nameWithOwner);
  return {
    id: release.id,
    owner,
    repo,
    tag: release.tagName,
    url: release.url,
    publishedAt: release.publishedAt!,
    ...(release.name ? { name: release.name } : {}),
  };
}

export function scanLimits(config: Config, startedAt = Date.now()): ScanLimits {
  return {
    startedAt,
    deadlineAt: startedAt + config.maxRuntimeMinutes * 60_000,
    minRemainingPoints: config.minRemainingPoints,
  };
}
