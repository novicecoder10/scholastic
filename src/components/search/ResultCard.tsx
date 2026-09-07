import type { CanonicalWork } from "@/lib/types/work";
import { SourceBadge, SOURCE_IDS, SOURCE_LABELS } from "@/components/search/SourceBadge";
import { SummaryButton } from "@/components/search/SummaryButton";
import { CitationsPanel } from "@/components/search/CitationsPanel";
import { CitationGraphSection } from "@/components/search/CitationGraphSection";
import { SimilarPapersPanel } from "@/components/search/SimilarPapersPanel";
import { ChatPanel } from "@/components/search/ChatPanel";
import { CiteButton } from "@/components/citations/CiteButton";
import { SaveButton } from "@/components/library/SaveButton";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Provenance spine: one tick per aggregated source, lit for the sources that
 * actually returned this record. Cross-source agreement is a real ranking
 * factor, so the strip is data, not ornament — the tallest spines are the
 * records every index agrees on.
 */
function SourceSpine({ sourceIds, label }: { sourceIds: string[]; label: string }) {
  const present = new Set(sourceIds);
  return (
    <span
      title={label}
      aria-hidden="true"
      className="hidden shrink-0 flex-col justify-start gap-[3px] pt-1.5 sm:flex"
    >
      {SOURCE_IDS.map((id) => (
        <span
          key={id}
          className={`h-[3px] w-4 rounded-full ${present.has(id) ? "bg-accent" : "bg-line"}`}
        />
      ))}
    </span>
  );
}

export function ResultCard({ work, saved = false }: { work: CanonicalWork; saved?: boolean }) {
  const authorNames = work.authors.map((a) => a.name);
  const authorLine =
    authorNames.length > 4
      ? `${authorNames.slice(0, 4).join(", ")}, et al.`
      : authorNames.join(", ");
  const sourceIds = work.sources.map((s) => s.sourceId);
  const spineLabel = `Found in ${sourceIds.length} of ${SOURCE_IDS.length} sources: ${sourceIds
    .map((id) => SOURCE_LABELS[id] ?? id)
    .join(", ")}`;

  return (
    <article className="border-line bg-surface hover:border-line-strong flex gap-4 rounded-xl border p-5 transition-colors">
      <SourceSpine sourceIds={sourceIds} label={spineLabel} />

      <div className="min-w-0 flex-1">
        <h3 className="text-lg leading-snug font-semibold">
          <a
            href={work.landingPageUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link hover:underline"
          >
            {work.title}
          </a>
        </h3>

        <p className="text-muted mt-1 text-sm">
          {authorLine && <span>{authorLine}</span>}
          {work.year && (
            <span>
              {" · "}
              <span className="metric">{work.year}</span>
            </span>
          )}
          {work.venue && <span> · {work.venue}</span>}
        </p>

        {work.abstract && (
          <p className="text-ink/80 mt-2 text-sm">{truncate(work.abstract, 320)}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CiteButton work={work} />
          <SaveButton work={work} initiallySaved={saved} />
        </div>

        <SummaryButton workKey={work.workKey} />
        <ChatPanel
          context={`Title: ${work.title}${work.abstract ? `\n\nAbstract: ${work.abstract}` : ""}`}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {work.citationCount != null && (
            <span className="text-muted">
              <span className="metric text-ink">{work.citationCount.toLocaleString()}</span>{" "}
              citation
              {work.citationCount === 1 ? "" : "s"}
            </span>
          )}
          {work.isOpenAccess && work.pdfUrl && (
            <a
              href={work.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-success font-medium hover:underline"
            >
              Open access PDF
            </a>
          )}
          <span className="flex flex-wrap gap-1.5">
            {work.sources.map((s) => (
              <SourceBadge key={s.sourceId} sourceId={s.sourceId} citationCount={s.citationCount} />
            ))}
          </span>
        </div>

        <CitationsPanel workKey={work.workKey} />
        <CitationGraphSection workKey={work.workKey} doi={work.doi} title={work.title} />
        <SimilarPapersPanel workKey={work.workKey} />
      </div>
    </article>
  );
}
