import type { ProviderStatusEntry } from "@/lib/types/search";

export function DegradedBanner({ providerStatuses }: { providerStatuses: ProviderStatusEntry[] }) {
  const failed = providerStatuses.filter((p) => p.status !== "ok" && p.status !== "disabled");
  if (failed.length === 0) return null;

  return (
    <div
      role="status"
      className="border-warning-line bg-warning-bg text-warning-ink mb-4 rounded-xl border px-4 py-3 text-sm"
    >
      {failed.length} of {providerStatuses.length} source{providerStatuses.length === 1 ? "" : "s"}{" "}
      temporarily unavailable ({failed.map((p) => p.displayName).join(", ")}) — results may be
      incomplete.
    </div>
  );
}
