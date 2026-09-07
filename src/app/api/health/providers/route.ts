import { NextResponse } from "next/server";
import { getProviderHealthSummary } from "@/lib/resilience/providerHealthSummary";

/**
 * Read-only view of every registered provider's current health, for the
 * frontend/ops use. Never exposes credential values — only booleans/state
 * derived from whether a credential is present, never the credential itself.
 */
export async function GET() {
  return NextResponse.json({ providers: getProviderHealthSummary() });
}
