import { loadConfig } from "./src/config.ts";
import { syncStarredReleases } from "./main.ts";

try {
  await syncStarredReleases(loadConfig());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (typeof globalThis.Deno !== "undefined") {
    Deno.exit(1);
  } else {
    process.exit(1);
  }
}
