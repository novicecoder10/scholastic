import { meteredLlm } from "@/lib/credits/metered";
import { buildSynthesisContext } from "@/lib/ai/synthesisContext";
import { validateDraft, type ValidatedDraft } from "@/lib/manuscript/draftGuard";
import { logger } from "@/lib/log/logger";

export interface DraftSource {
  workKey: string;
  title: string;
  abstract: string | null;
}

/**
 * The one generative mode, and its shape is a position rather than a
 * limitation.
 *
 * It drafts a literature summary from sources the user chose, with attribution
 * on every sentence. It is not a ghost-writer for arbitrary academic prose —
 * the same reasoning on which `ROADMAP.md` declines to build an AI detector: a
 * tool that produces unattributed academic text on demand is at odds with what
 * this project is for.
 */
const DRAFT_PROMPT = `You are drafting a related-work paragraph for a researcher, using ONLY the sources they supplied.

Every sentence you write must cite at least one of those sources, written as [[workKey]] using the exact key given. A sentence with no citation will be deleted before the researcher ever sees it, so a sentence you cannot attribute is a sentence not worth writing.

Rules:
- Only the workKeys listed below. A key that is not in the list is deleted.
- Say what the sources say. Do not add background, context, or implications they do not state.
- Where sources disagree, say so and cite both.
- No opening throat-clearing, no closing summary, no headings. Plain prose.
- Never refer to a source as "Paper 1", "Source 2", or by its key. Write about the findings and let the citation carry the attribution, the way a related-work section does.

Write 4-8 sentences.`;

export interface DraftResult {
  draft: ValidatedDraft;
  /** True when every sentence was stripped, so the caller inserts nothing. */
  empty: boolean;
}

export async function generateGroundedDraft(
  topic: string,
  sources: DraftSource[],
): Promise<DraftResult | null> {
  if (sources.length === 0) return null;

  const metered = await meteredLlm("grounded_draft", "quality");
  if (!metered) return null;

  // Ranked against the section topic exactly as multi-paper synthesis chat
  // already does — no new retrieval layer, and the same ordering the user would
  // get by asking the same question in chat.
  const context = await buildSynthesisContext(topic, sources);
  const keys = sources.map((s) => s.workKey);

  const raw = await metered.provider.complete({
    model: metered.provider.models.capable,
    system: DRAFT_PROMPT,
    messages: [
      {
        role: "user",
        content: `Section topic: ${topic}\n\nAvailable workKeys:\n${keys
          .map((k) => `- ${k}`)
          .join("\n")}\n\nSources:\n${context}`,
      },
    ],
    onUsage: metered.onUsage,
    maxTokens: 2000,
  });

  const draft = validateDraft(raw, keys);
  if (draft.droppedUncited > 0 || draft.droppedForeign > 0) {
    logger.info(
      {
        event: "grounded_draft_filtered",
        droppedUncited: draft.droppedUncited,
        droppedForeign: draft.droppedForeign,
      },
      "grounded draft sentences removed by the citation guard",
    );
  }

  return { draft, empty: draft.sentences.length === 0 };
}
