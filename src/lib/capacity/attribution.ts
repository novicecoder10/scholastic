/**
 * Saying who paid for an answer.
 *
 * A sponsor donates capacity to a commons, not to a customer, so this is the
 * only return they get: their name next to the work their quota did. It is
 * opt-in twice over — a source is only named if the operator marked it public
 * *and* recorded a sponsor name — and it names the donor, never the researcher.
 *
 * Which sponsor served is not known until a call completes, because the
 * dispatcher may have failed over. That rules out a header on a streamed
 * response, where the head is written before the first token; those routes say
 * nothing rather than guessing at the source they started with.
 */

/** Non-ASCII in a header value is not transmissible, and a sponsor name is
 * operator-supplied text that may legitimately contain it (an umlaut, a CJK
 * institution name). The readable form goes in the body; this is the machine
 * one. */
export function attributionHeaders(sponsor: string | null): Record<string, string> {
  if (!sponsor) return {};
  const ascii = sponsor.replace(/[^\x20-\x7E]/g, "").trim();
  return ascii ? { "X-Capacity-Sponsor": ascii.slice(0, 120) } : {};
}

/** The line a page shows under an AI answer. Null when there is nobody to
 * thank — an operator-funded instance should not invent a benefactor. */
export function attributionLine(sponsor: string | null): string | null {
  return sponsor ? `Capacity supported by ${sponsor}` : null;
}
