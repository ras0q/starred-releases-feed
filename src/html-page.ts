import {
  dayAnchor,
  escapeHtml,
  formatEntryTitle,
  renderDayBodyHtml,
} from "./feed-content.ts";
import type { AppState } from "./state.ts";
import { sealedFeedDays } from "./state.ts";

export type RunStatus = {
  stoppedBecause: "complete" | "time" | "rate-limit";
  releaseCount: number;
  sealedDays: number;
  durationMs: number;
  generatedAt: Date;
};

/**
 * Renders a single HTML page containing the same sealed days as the Atom feed.
 */
export function renderHtmlPage(
  state: AppState,
  options: {
    feedUrl: string;
    htmlUrl: string;
    title: string;
    subtitle: string;
    authorName: string;
    authorUri?: string;
    retentionDays: number;
    run: RunStatus;
  },
): string {
  const days = [...sealedFeedDays(state, options.retentionDays)].reverse();
  const daySections = days.map((date) => {
    const releases = state.feed.days[date] ?? [];
    return `
    <article class="day" id="${escapeHtml(dayAnchor(date))}">
      <h2>${escapeHtml(formatEntryTitle(date, releases))}</h2>
      ${renderDayBodyHtml(releases)}
    </article>`;
  }).join("");

  const authorLink = options.authorUri
    ? `<a href="${escapeHtml(options.authorUri)}">${
      escapeHtml(options.authorName)
    }</a>`
    : escapeHtml(options.authorName);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <link rel="alternate" type="application/atom+xml" href="${
    escapeHtml(options.feedUrl)
  }" title="${escapeHtml(options.title)}">
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: system-ui, sans-serif;
        line-height: 1.5;
        margin: 2rem auto;
        max-width: 48rem;
        padding: 0 1rem;
      }
      header, section, article { margin-bottom: 2rem; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; }
      dt { font-weight: 600; }
      ul { padding-left: 1.25rem; }
      .day ul ul { margin-top: 0.25rem; }
      .meta { color: #666; }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(options.title)}</h1>
      <p class="meta">${escapeHtml(options.subtitle)}</p>
      <p class="meta">By ${authorLink}</p>
      <p><a href="${escapeHtml(options.feedUrl)}">Subscribe via Atom</a></p>
    </header>
    <section id="status">
      <h2>Latest run</h2>
      <dl>
        <dt>Generated at</dt>
        <dd>${escapeHtml(options.run.generatedAt.toISOString())}</dd>
        <dt>Stopped because</dt>
        <dd>${escapeHtml(options.run.stoppedBecause)}</dd>
        <dt>Releases merged this run</dt>
        <dd>${options.run.releaseCount}</dd>
        <dt>Sealed days shown</dt>
        <dd>${options.run.sealedDays}</dd>
        <dt>Duration</dt>
        <dd>${escapeHtml(formatDuration(options.run.durationMs))}</dd>
      </dl>
    </section>
    <section id="days">
      ${daySections || "<p>No sealed release days are available yet.</p>"}
    </section>
  </body>
</html>
`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = Math.round(durationMs / 100) / 10;
  return `${seconds} s`;
}
