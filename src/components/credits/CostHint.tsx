import { estimateCredits } from "@/lib/credits/cost";

/**
 * "~4 credits" next to the control that spends them.
 *
 * The cost of an expensive action is shown **before** it runs — one of #6's two
 * hard rules. A commons where you find out the price by watching your balance
 * drop is a commons nobody can budget in.
 *
 * `lib/credits/cost.ts` is pure and importable from a Client Component, so this
 * reads the same table the server charges against rather than a duplicate.
 */
export function CostHint({ feature, className = "" }: { feature: string; className?: string }) {
  return (
    <span
      className={`text-muted text-[11px] ${className}`}
      title="Estimated — you're charged for the tokens actually used"
    >
      ~{estimateCredits(feature)} credits
    </span>
  );
}
