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

function formatDayContent(releases: ReleaseRecord[]): string {
  if (releases.length === 0) {
    return "<p>No starred repository releases on this day.</p>";
  }

  const items = releases.map((release) => {
    const label = `${release.owner}/${release.repo}@${release.tag}`;
    return `<li><a href="${escapeXml(release.url)}">${
      escapeXml(label)
    }</a></li>`;
  }).join("");

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
