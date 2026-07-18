import type { ReleaseRecord } from "./state.ts";

export function repoKey(release: ReleaseRecord): string {
  return `${release.owner}/${release.repo}`;
}

export function repoUrl(release: ReleaseRecord): string {
  return `https://github.com/${release.owner}/${release.repo}`;
}

export function dayAnchor(date: string): string {
  return date;
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

/**
 * Builds a descriptive daily entry title including release and repository counts.
 */
export function formatEntryTitle(
  date: string,
  releases: ReleaseRecord[],
): string {
  const releaseCount = releases.length;
  const repoCount = groupReleasesByRepo(releases).length;

  if (releaseCount === 0) {
    return `Starred releases on ${date} (no releases)`;
  }

  const releaseLabel = releaseCount === 1
    ? "1 release"
    : `${releaseCount} releases`;
  const repoLabel = repoCount === 1
    ? "1 repository"
    : `${repoCount} repositories`;
  return `Starred releases on ${date} (${releaseLabel} from ${repoLabel})`;
}

export function formatRepoHeading(key: string, releaseCount: number): string {
  const countLabel = releaseCount === 1
    ? "1 release"
    : `${releaseCount} releases`;
  return `${key} (${countLabel})`;
}

/**
 * Renders the nested repository and release list for a single UTC day.
 */
export function renderDayBodyHtml(releases: ReleaseRecord[]): string {
  if (releases.length === 0) {
    return "<p>No starred repository releases on this day.</p>";
  }

  const items = groupReleasesByRepo(releases).map(
    ({ key, releases: repoReleases }) => {
      const first = repoReleases[0];
      const releaseItems = repoReleases.map((release) => {
        const label = release.name
          ? `${release.tag} — ${release.name}`
          : release.tag;
        return `<li><a href="${escapeHtml(release.url)}">${
          escapeHtml(label)
        }</a></li>`;
      }).join("");

      return `<li><a href="${escapeHtml(repoUrl(first))}">${
        escapeHtml(formatRepoHeading(key, repoReleases.length))
      }</a><ul>${releaseItems}</ul></li>`;
    },
  ).join("");

  return `<ul>${items}</ul>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
