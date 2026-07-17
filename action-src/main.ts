import * as core from "@actions/core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { syncStarredReleases } from "../main.ts";
import { loadConfig } from "../src/config.ts";

export function callerPath(
  workspace: string,
  input: string,
  name: string,
): string {
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, input);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${name} must stay within GITHUB_WORKSPACE`);
  }

  return resolved;
}

function parsePositiveInt(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

if (import.meta.main) {
  try {
    const workspace = process.env.GITHUB_WORKSPACE;
    if (!workspace) throw new Error("GITHUB_WORKSPACE is required");

    const statePath = callerPath(
      workspace,
      core.getInput("state-path"),
      "state-path",
    );
    const feedPath = callerPath(
      workspace,
      core.getInput("feed-path"),
      "feed-path",
    );

    const config = loadConfig({
      token: core.getInput("token", { required: true }),
      statePath,
      feedPath,
      feedUrl: core.getInput("feed-url"),
      maxRuntimeMinutes: parsePositiveInt(core.getInput("max-runtime-minutes")),
      minRemainingPoints: parsePositiveInt(
        core.getInput("min-remaining-points"),
      ),
      includePrereleases: core.getInput("include-prereleases") === "true",
      includeDrafts: core.getInput("include-drafts") === "true",
    });

    await mkdir(path.dirname(statePath), { recursive: true });
    await mkdir(path.dirname(feedPath), { recursive: true });

    const result = await syncStarredReleases(config);

    core.setOutput("stopped-because", result.stoppedBecause);
    core.setOutput("release-count", String(result.releaseCount));
    core.setOutput("sealed-days", String(result.sealedDays));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
