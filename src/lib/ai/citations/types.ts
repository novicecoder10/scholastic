export interface CitationRef {
  doi: string | null;
  /** Available from Semantic Scholar; OpenCitations' COCI API only exposes DOIs. */
  title: string | null;
  year: number | null;
}

export interface CitationEdges {
  /** Works that cite this one. */
  citing: CitationRef[];
  /** Works this one cites (its references). */
  cited: CitationRef[];
}
