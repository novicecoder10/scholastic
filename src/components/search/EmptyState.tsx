interface EmptyStateProps {
  variant: "no-results" | "all-sources-down" | "filtered-to-nothing";
}

const COPY: Record<EmptyStateProps["variant"], { title: string; body: string }> = {
  "no-results": {
    title: "No results found",
    body: "Try a different search term, or check the spelling of author names and keywords.",
  },
  "all-sources-down": {
    title: "We couldn't reach any data sources right now",
    body: "All connected sources failed to respond. This is usually temporary — please try again shortly.",
  },
  "filtered-to-nothing": {
    title: "No results match your filters",
    body: "Try widening the year range, lowering the minimum citation count, or clearing a source filter.",
  },
};

export function EmptyState({ variant }: EmptyStateProps) {
  const { title, body } = COPY[variant];
  return (
    <div role="status" className="border-line rounded-xl border border-dashed p-8 text-center">
      <p className="text-base font-medium">{title}</p>
      <p className="text-muted mt-1 text-sm">{body}</p>
    </div>
  );
}
