import { extractJson } from "@/lib/ai/json";
import { meteredLlm } from "@/lib/credits/metered";
import { logger } from "@/lib/log/logger";
import type { AggregatedTopic } from "@/lib/topics/aggregate";

export interface LabelledTheme {
  label: string;
  description: string;
  /** Concept names from the input list that this theme groups. Never contains
   * a name the aggregation didn't produce — see `keepOnlyKnownConcepts`. */
  concepts: string[];
}

const SYSTEM_PROMPT =
  "You group academic concepts into themes. You are given a ranked list of concepts extracted " +
  "from a set of search results. Cluster them into 5-8 themes and give each a short human " +
  "label (2-4 words) and a one-sentence description of what unites its concepts.\\n\\n" +
  "This is a LABELLING task, not a generation task. Every concept you place in a theme must be " +
  "copied verbatim from the list you were given. Do not invent concepts, do not invent themes " +
  "that the list does not support, and do not rename concepts. A concept may appear in at most " +
  "one theme; concepts that fit nowhere may be left out.\\n\\n" +
  'Respond with JSON only: {"themes":[{"label":"...","description":"...","concepts":["..."]}]}';


/**
 * Drops any concept the model produced that wasn't in the input, and any theme
 * left with nothing.
 *
 * This is the guard that makes the feature honest. A hallucinated concept here
 * isn't cosmetic: clicking a theme filters the result list by its concepts, so
 * an invented one would silently match nothing and look like a bug in search.
 */
export function keepOnlyKnownConcepts(
  themes: LabelledTheme[],
  known: Set<string>,
): LabelledTheme[] {
  return themes
    .map((theme) => ({ ...theme, concepts: theme.concepts.filter((c) => known.has(c)) }))
    .filter((theme) => theme.concepts.length > 0);
}

function parseThemes(raw: unknown): LabelledTheme[] {
  if (typeof raw !== "object" || raw === null) return [];
  const themes = (raw as { themes?: unknown }).themes;
  if (!Array.isArray(themes)) return [];

  return themes.flatMap((theme): LabelledTheme[] => {
    if (typeof theme !== "object" || theme === null) return [];
    const { label, description, concepts } = theme as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim()) return [];
    if (!Array.isArray(concepts)) return [];
    return [
      {
        label: label.trim(),
        description: typeof description === "string" ? description.trim() : "",
        concepts: concepts.filter((c): c is string => typeof c === "string"),
      },
    ];
  });
}

/**
 * One LLM call to cluster and label the aggregated concepts.
 *
 * Returns `null` — not an error — whenever labelling can't happen: no provider
 * configured, the call fails, or the output survives no validation. The caller
 * then shows the ranked concepts unlabelled, which is less polished and just
 * as usable. Same degradation contract as every other AI feature here.
 */
export async function labelTopics(topics: AggregatedTopic[]): Promise<LabelledTheme[] | null> {
  if (topics.length < 3) return null;

  // Topic labelling refuses quietly on an empty balance rather than surfacing
  // a credit error: the caller already degrades to unlabelled concepts, which
  // is a better answer than an error box over a working result list.
  const metered = await meteredLlm("topic_labels", "bulk").catch(() => null);
  if (!metered) return null;
  const provider = metered.provider;

  const list = topics.map((t) => `${t.name} (${t.count} papers)`).join("\n");

  try {
    const response = await provider.complete({
      model: provider.models.cheap,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Concepts:\n${list}` }],
      // Generous on purpose. Several backends default to a reasoning model
      // (Groq's is openai/gpt-oss-20b), and on those the reasoning trace is
      // billed against max_tokens *before* any content is emitted — a tight
      // budget comes back as a successful call with an empty string, which is
      // indistinguishable here from a model that had nothing to say. Observed
      // live at 900: the same request returned valid JSON on one call and ""
      // on the next.
      maxTokens: 2400,
    });

    if (response.trim() === "") {
      logger.warn(
        { event: "topic_labelling_empty", model: provider.models.cheap },
        "topic labelling returned an empty completion; falling back to unlabelled concepts",
      );
      return null;
    }

    const known = new Set(topics.map((t) => t.name));
    const themes = keepOnlyKnownConcepts(parseThemes(extractJson(response)), known);
    return themes.length > 0 ? themes : null;
  } catch (err) {
    logger.warn(
      { event: "topic_labelling_failed", err: String(err) },
      "topic labelling failed; falling back to unlabelled concepts",
    );
    return null;
  }
}
