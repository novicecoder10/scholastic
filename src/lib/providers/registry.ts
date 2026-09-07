import type { ProviderAdapter } from "@/lib/providers/types";
import { openAlexAdapter } from "@/lib/providers/openalex/adapter";
import { crossrefAdapter } from "@/lib/providers/crossref/adapter";
import { arxivAdapter } from "@/lib/providers/arxiv/adapter";
import { europePmcAdapter } from "@/lib/providers/europepmc/adapter";
import { doajAdapter } from "@/lib/providers/doaj/adapter";
import { semanticScholarAdapter } from "@/lib/providers/semanticscholar/adapter";
import { coreAdapter } from "@/lib/providers/core/adapter";
import { unpaywallAdapter } from "@/lib/providers/unpaywall/adapter";
import { pubmedAdapter } from "@/lib/providers/pubmed/adapter";

/**
 * Every registered provider. Adding or removing a source is adding/deleting one
 * `providers/<name>/` directory and one line here — nothing else in the app
 * references provider names directly.
 */
export const ALL_PROVIDERS: ProviderAdapter[] = [
  openAlexAdapter,
  crossrefAdapter,
  arxivAdapter,
  europePmcAdapter,
  doajAdapter,
  semanticScholarAdapter,
  coreAdapter,
  unpaywallAdapter,
  pubmedAdapter,
];

export function getEnabledProviders(): ProviderAdapter[] {
  return ALL_PROVIDERS.filter((p) => p.isConfigured());
}
