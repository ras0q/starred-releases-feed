import {
  dayAnchor,
  escapeHtml,
  formatEntryTitle,
  renderDayBodyHtml,
} from "./feed-content.ts";
import type { AppState } from "./state.ts";
import { sealedFeedDays } from "./state.ts";

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("&#39;", "&apos;");
}

function entryId(date: string): string {
  return `tag:github.com,2008:starred-releases:${date}`;
}

function renderAuthor(name: string, uri?: string): string {
  return uri
    ? `
  <author>
    <name>${escapeXml(name)}</name>
    <uri>${escapeXml(uri)}</uri>
  </author>`
    : `
  <author>
    <name>${escapeXml(name)}</name>
  </author>`;
}

/**
 * Renders sealed daily buckets from state into an Atom 1.0 feed document.
 */
export function renderAtom(
  state: AppState,
  options: {
    feedUrl: string;
    htmlUrl: string;
    title: string;
    subtitle: string;
    authorName: string;
    authorUri?: string;
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
    const htmlLink = `${options.htmlUrl}#${dayAnchor(date)}`;
    return `
  <entry>
    <title>${escapeXml(formatEntryTitle(date, releases))}</title>
    <link href="${escapeXml(htmlLink)}" rel="alternate" type="text/html"/>
    <id>${escapeXml(entryId(date))}</id>
    <updated>${escapeXml(dayUpdated)}</updated>
    <published>${escapeXml(`${date}T00:00:00.000Z`)}</published>${
      renderAuthor(options.authorName, options.authorUri)
    }
    <content type="html">${escapeXml(renderDayBodyHtml(releases))}</content>
  </entry>`;
  }).join("");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(options.title)}</title>
  <subtitle>${escapeXml(options.subtitle)}</subtitle>
  <link href="${
    escapeXml(options.feedUrl)
  }" rel="self" type="application/atom+xml"/>
  <link href="${
    escapeXml(options.htmlUrl)
  }" rel="alternate" type="text/html"/>${
    renderAuthor(options.authorName, options.authorUri)
  }
  <id>${escapeXml(options.feedUrl)}</id>
  <updated>${escapeXml(latestUpdated)}</updated>${entries}
</feed>
`;
}
