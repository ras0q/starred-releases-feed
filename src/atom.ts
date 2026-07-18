import type { AppState, ReleaseRecord } from "./state.ts";
import { sealedFeedDays } from "./state.ts";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function entryId(date: string): string {
  return `tag:github.com,2008:starred-releases:${date}`;
}

function formatDayTitle(date: string): string {
  return date;
}

function repoKey(release: ReleaseRecord): string {
  return `${release.owner}/${release.repo}`;
}

function repoUrl(release: ReleaseRecord): string {
  return `https://github.com/${release.owner}/${release.repo}`;
}

function compareReleases(a: ReleaseRecord, b: ReleaseRecord): number {
  const byTime = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  if (byTime !== 0) return byTime;
  return a.tag.localeCompare(b.tag);
}

/**
 * Groups releases by repository while preserving a stable repo and tag order.
 */
export function groupReleasesByRepo(
  releases: ReleaseRecord[],
): Array<{ key: string; releases: ReleaseRecord[] }> {
  const groups = new Map<string, ReleaseRecord[]>();

  for (const release of releases) {
    const key = repoKey(release);
    const bucket = groups.get(key) ?? [];
    bucket.push(release);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bucket]) => ({
      key,
      releases: bucket.sort(compareReleases),
    }));
}

function formatDayContent(releases: ReleaseRecord[]): string {
  if (releases.length === 0) {
    return "<p>No starred repository releases on this day.</p>";
  }

  const items = groupReleasesByRepo(releases).map(
    ({ key, releases: repoReleases }) => {
      const first = repoReleases[0];
      const releaseItems = repoReleases.map((release) =>
        `<li><a href="${escapeXml(release.url)}">${
          escapeXml(release.tag)
        }</a></li>`
      ).join("");

      return `<li><a href="${escapeXml(repoUrl(first))}">${
        escapeXml(key)
      }</a><ul>${releaseItems}</ul></li>`;
    },
  ).join("");

  return `<ul>${items}</ul>`;
}

/**
 * Renders sealed daily buckets from state into an Atom 1.0 feed document.
 */
export function renderAtom(
  state: AppState,
  options: {
    feedUrl: string;
    title: string;
    subtitle: string;
    retentionDays: number;
    updatedAt?: Date;
  },
): string {
  const days = sealedFeedDays(state, options.retentionDays);
  const updated = (options.updatedAt ?? new Date()).toISOString();
  const latestDay = days.at(-1);
  const latestUpdated = latestDay && state.feed.days[latestDay]?.[0]
    ? state.feed.days[latestDay][0].publishedAt
    : updated;

  const entries = days.map((date) => {
    const releases = state.feed.days[date] ?? [];
    const dayUpdated = releases[0]?.publishedAt ??
      `${date}T23:59:59.000Z`;
    return `
  <entry>
    <title>${escapeXml(formatDayTitle(date))}</title>
    <link href="${escapeXml(options.feedUrl)}#${
      escapeXml(date)
    }" rel="alternate" type="text/html"/>
    <id>${escapeXml(entryId(date))}</id>
    <updated>${escapeXml(dayUpdated)}</updated>
    <published>${escapeXml(`${date}T00:00:00.000Z`)}</published>
    <content type="html">${escapeXml(formatDayContent(releases))}</content>
  </entry>`;
  }).join("");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(options.title)}</title>
  <subtitle>${escapeXml(options.subtitle)}</subtitle>
  <link href="${
    escapeXml(options.feedUrl)
  }" rel="self" type="application/atom+xml"/>
  <link href="${escapeXml(options.feedUrl)}" rel="alternate" type="text/html"/>
  <id>${escapeXml(options.feedUrl)}</id>
  <updated>${escapeXml(latestUpdated)}</updated>${entries}
</feed>
`;
}
