/** Display order is the fan-out order used across the app's source lists. */
export const SOURCE_LABELS: Record<string, string> = {
  openalex: "OpenAlex",
  crossref: "Crossref",
  arxiv: "arXiv",
  europepmc: "Europe PMC",
  doaj: "DOAJ",
  semantic_scholar: "Semantic Scholar",
  core: "CORE",
  unpaywall: "Unpaywall",
  pubmed: "PubMed",
};

export const SOURCE_IDS = Object.keys(SOURCE_LABELS);

export function SourceBadge({
  sourceId,
  citationCount,
}: {
  sourceId: string;
  citationCount?: number | null;
}) {
  const label = SOURCE_LABELS[sourceId] ?? sourceId;
  const title =
    citationCount != null ? `${label} — ${citationCount.toLocaleString()} citations` : label;

  return (
    <span
      title={title}
      className="border-line text-muted inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
    >
      {label}
    </span>
  );
}
