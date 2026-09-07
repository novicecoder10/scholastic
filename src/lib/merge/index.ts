import type { RawWork } from "@/lib/providers/types";
import type { CanonicalWork } from "@/lib/types/work";
import { clusterWorks } from "@/lib/merge/matcher";
import { reconcileCluster } from "@/lib/merge/reconcile";

export function mergeWorks(works: RawWork[]): CanonicalWork[] {
  return clusterWorks(works).map(reconcileCluster);
}

export { clusterWorks } from "@/lib/merge/matcher";
export { reconcileCluster } from "@/lib/merge/reconcile";
export {
  rankWorks,
  scoreWork,
  rankWorksBySimilarity,
  scoreWorkBySimilarity,
} from "@/lib/merge/rank";
