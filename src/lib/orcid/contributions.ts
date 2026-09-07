import type { Contribution } from "@/lib/credits/grants";
import { logger } from "@/lib/log/logger";

/**
 * Turns a verified ORCID iD into a list of grantable contributions.
 *
 * Publications come from OpenAlex, which this app already queries — no new
 * provider, no new key. Peer reviews come from ORCID's own public record, which
 * is the only place they exist. Both are read anonymously: the OAuth token
 * proved who the person is and is then discarded.
 */

const OPENALEX_WORKS = "https://api.openalex.org/works";
const ORCID_PUB_API = "https://pub.orcid.org/v3.0";

/** OpenAlex asks callers to identify themselves; the adapter already does this
 * with the same variable. */
function mailtoParam(url: URL): void {
  if (process.env.OPENALEX_EMAIL) url.searchParams.set("mailto", process.env.OPENALEX_EMAIL);
}

/** One page is enough. A grant run is a fairness exercise, not a bibliography
 * import, and diminishing returns have flattened the value of the tail long
 * before 200 works. */
const MAX_WORKS = 200;

export async function fetchPublications(orcid: string): Promise<Contribution[]> {
  const url = new URL(OPENALEX_WORKS);
  url.searchParams.set("filter", `author.orcid:${orcid}`);
  url.searchParams.set("per-page", String(Math.min(MAX_WORKS, 200)));
  url.searchParams.set("select", "id,display_name,publication_year");
  url.searchParams.set("sort", "publication_year:desc");
  mailtoParam(url);

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      logger.warn(
        { event: "orcid_publications_fetch_failed", status: response.status },
        "OpenAlex author lookup failed",
      );
      return [];
    }
    const json = (await response.json()) as {
      results?: Array<{ id?: string; display_name?: string; publication_year?: number }>;
    };
    return (json.results ?? [])
      .filter((w): w is { id: string; display_name?: string; publication_year?: number } =>
        Boolean(w.id),
      )
      .map((w) => ({
        // The bare id, not the full URL: it is an idempotency key that will
        // outlive OpenAlex's choice of hostname.
        id: w.id.replace(/^https?:\/\/openalex\.org\//, ""),
        kind: "publication" as const,
        title: w.display_name ?? "Untitled work",
        year: w.publication_year ?? null,
      }));
  } catch (err) {
    logger.warn({ event: "orcid_publications_error", err: String(err) }, "publication fetch failed");
    return [];
  }
}

interface OrcidPeerReviewSummary {
  "put-code"?: number;
  "completion-date"?: { year?: { value?: string } };
}

export async function fetchPeerReviews(orcid: string): Promise<Contribution[]> {
  try {
    const response = await fetch(`${ORCID_PUB_API}/${orcid}/peer-reviews`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      logger.warn(
        { event: "orcid_reviews_fetch_failed", status: response.status },
        "ORCID peer-review lookup failed",
      );
      return [];
    }
    const json = (await response.json()) as {
      group?: Array<{
        "peer-review-group"?: Array<{ "peer-review-summary"?: OrcidPeerReviewSummary[] }>;
      }>;
    };

    // ORCID nests summaries three deep: group → peer-review-group →
    // peer-review-summary. Flattened here rather than at the call site, since
    // the shape is ORCID's problem and nothing else should have to know it.
    const contributions: Contribution[] = [];
    for (const group of json.group ?? []) {
      for (const reviewGroup of group["peer-review-group"] ?? []) {
        for (const summary of reviewGroup["peer-review-summary"] ?? []) {
          const putCode = summary["put-code"];
          if (putCode == null) continue;
          const year = summary["completion-date"]?.year?.value;
          contributions.push({
            id: String(putCode),
            kind: "peer_review",
            title: "Peer review",
            year: year ? Number(year) : null,
          });
        }
      }
    }
    return contributions;
  } catch (err) {
    logger.warn({ event: "orcid_reviews_error", err: String(err) }, "peer-review fetch failed");
    return [];
  }
}

/** Publications first, so the diminishing-returns curve applies to authorship
 * and never pushes reviews down it — reviewing is the scarcer contribution. */
export async function fetchContributions(orcid: string): Promise<Contribution[]> {
  const [publications, reviews] = await Promise.all([
    fetchPublications(orcid),
    fetchPeerReviews(orcid),
  ]);
  return [...publications, ...reviews];
}
