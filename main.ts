import { renderAtom } from "./src/atom.ts";
import type { Config } from "./src/config.ts";
import { renderHtmlPage } from "./src/html-page.ts";
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
  html: string;
  stoppedBecause: "complete" | "time" | "rate-limit";
  releaseCount: number;
  sealedDays: number;
  durationMs: number;
};

type SyncDeps = {
  fetch: typeof fetch;
  now: () => Date;
  persist: boolean;
};

/**
 * Scans starred repositories, updates state, and renders feed projections.
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

  const renderOptions = {
    feedUrl: config.feedUrl,
    htmlUrl: config.htmlUrl,
    title: "Starred repository releases",
    subtitle: "Daily releases from GitHub repositories you starred",
    authorName: config.authorName,
    authorUri: config.authorUri,
    retentionDays: config.feedRetentionDays,
    updatedAt: d.now(),
  };

  const durationMs = Date.now() - started;
  const run = {
    stoppedBecause: scan.stoppedBecause,
    releaseCount: scan.releases.length,
    sealedDays: state.feed.sealedDates.length,
    durationMs,
    generatedAt: d.now(),
  };

  const atom = renderAtom(state, renderOptions);
  const html = renderHtmlPage(state, { ...renderOptions, run });

  if (d.persist) {
    await saveState(config.statePath, state);
    await writeFile(config.feedPath, atom);
    await writeFile(config.htmlPath, html);
  }

  console.error(
    `Sync finished: releases=${scan.releases.length}, sealed days=${state.feed.sealedDates.length}, stop=${scan.stoppedBecause}, duration=${durationMs}ms`,
  );

  return {
    atom,
    html,
    stoppedBecause: scan.stoppedBecause,
    releaseCount: scan.releases.length,
    sealedDays: state.feed.sealedDates.length,
    durationMs,
  };
}

async function writeFile(path: string, contents: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  await mkdir(nodePath.dirname(path), { recursive: true });
  await writeFile(path, contents);
}
