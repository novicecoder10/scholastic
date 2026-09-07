import type { RawWorkTopic } from "@/lib/providers/types";
import type { CanonicalWork } from "@/lib/types/work";

export interface AggregatedTopic {
  name: string;
  /** How many works in the set carry this concept. */
  count: number;
  /** Sum of per-work confidence scores. Ranks a concept that a few works are
   * strongly about above one that many works mention in passing. */
  weight: number;
  /** The works carrying it, so clicking a theme can filter without a re-query. */
  workKeys: string[];
}

/** Below this the concept is noise the source itself isn't confident about. */
const MIN_SCORE = 0.2;

/** More than this and the list stops being a structure and becomes a dump. */
export const MAX_CANDIDATES = 40;

/**
 * Frequency-and-confidence aggregation over concepts the sources already
 * returned. Deterministic, free, and no model — the LLM's only job downstream
 * is to *label* clusters of this list, never to invent its members.
 *
 * Ties break on name so the ordering is stable across identical result sets;
 * an unstable order would make the panel reshuffle on every render.
 */
export function aggregateTopics(works: CanonicalWork[]): AggregatedTopic[] {
  const byName = new Map<string, AggregatedTopic>();

  for (const work of works) {
    for (const topic of work.topics ?? []) {
      if (topic.score < MIN_SCORE) continue;
      const existing = byName.get(topic.name);
      if (existing) {
        existing.count += 1;
        existing.weight += topic.score;
        existing.workKeys.push(work.workKey);
      } else {
        byName.set(topic.name, {
          name: topic.name,
          count: 1,
          weight: topic.score,
          workKeys: [work.workKey],
        });
      }
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_CANDIDATES);
}

/** A concept every single work carries describes the query, not its structure
 * — "Machine learning" on a machine-learning search tells the user nothing and
 * filtering by it removes nothing. Dropped once the set is big enough for
 * "every" to mean something. */
export function dropUniversalTopics(
  topics: AggregatedTopic[],
  totalWorks: number,
): AggregatedTopic[] {
  if (totalWorks < 5) return topics;
  return topics.filter((t) => t.count < totalWorks);
}

/** Convenience for callers that only need the ranked names. */
export function topicNames(topics: AggregatedTopic[]): string[] {
  return topics.map((t) => t.name);
}

export type { RawWorkTopic };
