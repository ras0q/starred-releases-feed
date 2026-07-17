import { renderAtom } from "./src/atom.ts";
import type { Config } from "./src/config.ts";
import { runScan, scanLimits } from "./src/scan.ts";
import {
  loadState,
  mergeReleases,
  pruneFeed,
  saveState,
  sealPastDays,
} from "./src/state.ts";

export type SyncResult = {
  atom: string;
  stoppedBecause: "complete" | "time" | "rate-limit";
  releaseCount: number;
  sealedDays: number;
};

type SyncDeps = {
  fetch: typeof fetch;
  now: () => Date;
  persist: boolean;
};

/**
 * Scans starred repositories, updates state, and renders the Atom feed projection.
 */
export async function syncStarredReleases(
  config: Config,
  deps: Partial<SyncDeps> = {},
): Promise<SyncResult> {
  const d: SyncDeps = {
    fetch: fetch,
    now: () => new Date(),
    persist: true,
    ...deps,
  };

  const started = Date.now();
  const state = await loadState(config.statePath);
  console.error(
    `Sync started: retention=${config.feedRetentionDays} days, runtime=${config.maxRuntimeMinutes} min, min points=${config.minRemainingPoints}`,
  );

  const scan = await runScan(
    state,
    config,
    scanLimits(config, started),
    { fetch: d.fetch, now: d.now },
  );
  mergeReleases(state, scan.releases);
  sealPastDays(state, d.now());
  pruneFeed(state, config.feedRetentionDays);

  const atom = renderAtom(state, {
    feedUrl: config.feedUrl,
    title: "Starred repository releases",
    subtitle: "Daily releases from GitHub repositories you starred",
    retentionDays: config.feedRetentionDays,
    updatedAt: d.now(),
  });

  if (d.persist) {
    await saveState(config.statePath, state);
    await writeFeed(config.feedPath, atom);
  }

  console.error(
    `Sync finished: releases=${scan.releases.length}, sealed days=${state.feed.sealedDates.length}, stop=${scan.stoppedBecause}, duration=${
      Date.now() - started
    }ms`,
  );

  return {
    atom,
    stoppedBecause: scan.stoppedBecause,
    releaseCount: scan.releases.length,
    sealedDays: state.feed.sealedDates.length,
  };
}

async function writeFeed(path: string, atom: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  await mkdir(nodePath.dirname(path), { recursive: true });
  await writeFile(path, atom);
}
