import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createDispatchingProvider,
  dispatchStatus,
  rankSources,
  shouldFailOver,
  type Candidate,
  type CapacitySourceRow,
} from "@/lib/capacity/sources";
import type { LlmProvider } from "@/lib/ai/llm/types";

const JANUARY = new Date("2026-01-15T00:00:00Z");

function source(overrides: Partial<CapacitySourceRow> = {}): CapacitySourceRow {
  return {
    id: "operator-groq",
    label: "Operator (Groq)",
    providerId: "groq",
    credentialRef: "TEST_CAPACITY_KEY",
    sponsorName: null,
    sponsorUrl: null,
    isPublic: false,
    monthlyTokenCap: null,
    tokensUsedPeriod: 0,
    periodStartsAt: JANUARY,
    status: "active",
    baseUrl: null,
    servedModel: null,
    activeHoursUtc: null,
    activeDays: null,
    dormantUntil: null,
    ...overrides,
  };
}

describe("rankSources", () => {
  beforeEach(() => {
    process.env.TEST_CAPACITY_KEY = "present";
  });
  afterEach(() => {
    delete process.env.TEST_CAPACITY_KEY;
    delete process.env.OTHER_CAPACITY_KEY;
  });

  it("prefers sponsor capacity over operator capacity", () => {
    // The whole point of the pool: donated quota should actually be consumed,
    // not sit unused behind the operator's own key.
    const ranked = rankSources(
      [
        source({ id: "operator", providerId: "anthropic" }),
        source({ id: "sponsor", providerId: "gemini", sponsorName: "Acme Labs" }),
      ],
      JANUARY,
    );
    expect(ranked.map((r) => r.id)).toEqual(["sponsor", "operator"]);
  });

  it("falls back to the static preference order among equals", () => {
    const ranked = rankSources(
      [source({ id: "b", providerId: "openrouter" }), source({ id: "a", providerId: "anthropic" })],
      JANUARY,
    );
    expect(ranked.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("skips a source whose environment variable is absent", () => {
    // The database records that a key should exist; it never holds one. A row
    // naming a variable nobody set describes capacity this instance cannot use.
    const ranked = rankSources([source({ credentialRef: "OTHER_CAPACITY_KEY" })], JANUARY);
    expect(ranked).toEqual([]);
  });

  it("skips a source that has crossed its cap", () => {
    const ranked = rankSources(
      [source({ monthlyTokenCap: 1000, tokensUsedPeriod: 1000 })],
      JANUARY,
    );
    expect(ranked).toEqual([]);
  });

  it("restores an exhausted source once the period has rolled over", () => {
    const exhausted = source({
      status: "exhausted",
      monthlyTokenCap: 1000,
      tokensUsedPeriod: 1000,
      periodStartsAt: JANUARY,
    });
    expect(rankSources([exhausted], JANUARY)).toEqual([]);
    expect(rankSources([exhausted], new Date("2026-02-01T00:00:00Z"))).toHaveLength(1);
  });

  it("never returns a disabled source, even after a rollover", () => {
    const disabled = source({ status: "disabled" });
    expect(rankSources([disabled], new Date("2026-06-01T00:00:00Z"))).toEqual([]);
  });

  it("skips a row naming a provider this build does not have", () => {
    expect(rankSources([source({ providerId: "some-future-provider" })], JANUARY)).toEqual([]);
  });
});

describe("rankSources for an anonymous visitor", () => {
  beforeEach(() => {
    process.env.TEST_CAPACITY_KEY = "present";
  });
  afterEach(() => {
    delete process.env.TEST_CAPACITY_KEY;
  });

  it("draws from operator capacity only", () => {
    // Sponsors donate for researchers, not for an unauthenticated firehose.
    const ranked = rankSources(
      [
        source({ id: "sponsor", sponsorName: "Acme Labs" }),
        source({ id: "operator", providerId: "anthropic" }),
      ],
      JANUARY,
      false,
    );
    expect(ranked.map((r) => r.id)).toEqual(["operator"]);
  });

  it("has nothing to draw on when every source is sponsored", () => {
    // Falls through to static selection rather than quietly spending donated
    // quota.
    expect(rankSources([source({ sponsorName: "Acme Labs" })], JANUARY, false)).toEqual([]);
  });
});

describe("rankSources — endpoints, schedules and dormancy", () => {
  beforeEach(() => {
    process.env.TEST_CAPACITY_KEY = "present";
  });
  afterEach(() => {
    delete process.env.TEST_CAPACITY_KEY;
  });

  const NIGHT = new Date("2026-01-15T23:00:00Z");
  const NOON = new Date("2026-01-15T12:00:00Z");

  it("accepts a node with no credential, which a keyed provider may never be", () => {
    const node = source({
      id: "hpc",
      providerId: "node",
      credentialRef: null,
      baseUrl: "https://hpc.example/v1",
      servedModel: "llama",
    });
    const broken = source({ id: "broken", providerId: "groq", credentialRef: null });
    expect(rankSources([node, broken], NOON).map((r) => r.id)).toEqual(["hpc"]);
  });

  it("leaves a donated node out of the pool outside its donated hours", () => {
    const overnight = source({
      id: "hpc",
      providerId: "node",
      credentialRef: null,
      baseUrl: "https://hpc.example/v1",
      servedModel: "llama",
      activeHoursUtc: "18:00-06:00",
    });
    expect(rankSources([overnight], NIGHT)).toHaveLength(1);
    expect(rankSources([overnight], NOON)).toHaveLength(0);
  });

  it("skips a source the dispatcher tripped, and takes it back when the clock passes", () => {
    const tripped = source({
      id: "throttled",
      status: "dormant",
      dormantUntil: new Date("2026-01-15T12:05:00Z"),
    });
    expect(rankSources([tripped], NOON)).toHaveLength(0);
    expect(rankSources([tripped], new Date("2026-01-15T12:06:00Z"))).toHaveLength(1);
  });

  it("ranks a verified named provider ahead of an endpoint of equal standing", () => {
    const node = source({
      id: "hpc",
      providerId: "node",
      credentialRef: null,
      baseUrl: "https://hpc.example/v1",
      servedModel: "llama",
    });
    const named = source({ id: "groq" });
    expect(rankSources([node, named], NOON).map((r) => r.id)).toEqual(["groq", "hpc"]);
  });

  it("still puts a sponsor's endpoint ahead of the operator's own key", () => {
    const relay = source({
      id: "mp-relay",
      providerId: "outpost",
      credentialRef: "TEST_CAPACITY_KEY",
      baseUrl: "https://relay.example/v1",
      servedModel: "mistral-large",
      sponsorName: "Max Planck",
    });
    const operator = source({ id: "operator" });
    expect(rankSources([relay, operator], NOON).map((r) => r.id)).toEqual(["mp-relay", "operator"]);
  });
});

describe("dispatchStatus", () => {
  it("reads the status off an SDK error object", () => {
    expect(dispatchStatus(Object.assign(new Error("nope"), { status: 429 }))).toBe(429);
  });

  it("reads it out of the message the OpenAI-compatible factory throws", () => {
    expect(dispatchStatus(new Error("groq_llm request failed with status 401"))).toBe(401);
  });

  it("is null when the failure was not an HTTP one", () => {
    expect(dispatchStatus(new Error("fetch failed"))).toBeNull();
  });
});

describe("shouldFailOver", () => {
  it("moves on when this source is spent, throttled or shut off", () => {
    for (const status of [401, 402, 403, 429]) expect(shouldFailOver(status)).toBe(true);
  });

  it("moves on for a server fault or a network one", () => {
    expect(shouldFailOver(503)).toBe(true);
    expect(shouldFailOver(null)).toBe(true);
  });

  it("does not burn another sponsor's quota on a request that is simply wrong", () => {
    expect(shouldFailOver(400)).toBe(false);
    expect(shouldFailOver(404)).toBe(false);
  });
});

describe("createDispatchingProvider", () => {
  function stub(models: { cheap: string; capable: string }, behaviour: () => Promise<string>) {
    return {
      models,
      isConfigured: () => true,
      complete: behaviour,
      async *streamComplete() {
        yield await behaviour();
      },
    } as unknown as LlmProvider;
  }

  const TIERS = { cheap: "small", capable: "large" };

  function candidate(id: string | null, provider: LlmProvider): Candidate {
    return { row: id ? source({ id }) : null, provider };
  }

  it("returns the first source's answer without touching the rest", async () => {
    let secondCalls = 0;
    const state = { served: {} as Candidate };
    const candidates = [
      candidate(
        "first",
        stub(TIERS, async () => "from first"),
      ),
      candidate(
        "second",
        stub(TIERS, async () => {
          secondCalls += 1;
          return "from second";
        }),
      ),
    ];
    state.served = candidates[0];

    const provider = createDispatchingProvider(candidates, state);
    await expect(provider.complete({ model: "large", messages: [] })).resolves.toBe("from first");
    expect(secondCalls).toBe(0);
    expect(state.served.row?.id).toBe("first");
  });

  it("falls over to the next source when the first is out of quota", async () => {
    const state = { served: {} as Candidate };
    const candidates = [
      candidate(
        "spent",
        stub(TIERS, async () => {
          throw new Error("groq_llm request failed with status 429");
        }),
      ),
      candidate(
        "spare",
        stub(TIERS, async () => "from spare"),
      ),
    ];
    state.served = candidates[0];

    const provider = createDispatchingProvider(candidates, state);
    await expect(provider.complete({ model: "large", messages: [] })).resolves.toBe("from spare");
    // The tokens must be billed to whoever actually answered.
    expect(state.served.row?.id).toBe("spare");
  });

  it("asks each backend for its own model id, not the first one's", async () => {
    const asked: string[] = [];
    const state = { served: {} as Candidate };
    const candidates = [
      candidate(
        "first",
        stub({ cheap: "small-a", capable: "large-a" }, async () => {
          throw new Error("request failed with status 429");
        }),
      ),
      candidate(
        "second",
        (() => {
          const models = { cheap: "small-b", capable: "large-b" };
          return {
            models,
            isConfigured: () => true,
            async complete({ model }: { model: string }) {
              asked.push(model);
              return "ok";
            },
            async *streamComplete() {},
          } as unknown as LlmProvider;
        })(),
      ),
    ];
    state.served = candidates[0];

    const provider = createDispatchingProvider(candidates, state);
    await provider.complete({ model: "small-a", messages: [] });
    expect(asked).toEqual(["small-b"]);
  });

  it("gives up rather than replaying a request that is wrong everywhere", async () => {
    let secondCalls = 0;
    const state = { served: {} as Candidate };
    const candidates = [
      candidate(
        "first",
        stub(TIERS, async () => {
          throw new Error("request failed with status 400");
        }),
      ),
      candidate(
        "second",
        stub(TIERS, async () => {
          secondCalls += 1;
          return "unreachable";
        }),
      ),
    ];
    state.served = candidates[0];

    const provider = createDispatchingProvider(candidates, state);
    await expect(provider.complete({ model: "large", messages: [] })).rejects.toThrow("400");
    expect(secondCalls).toBe(0);
  });

  it("never restarts a stream that has already delivered a token", async () => {
    const state = { served: {} as Candidate };
    const candidates = [
      candidate("first", {
        models: TIERS,
        isConfigured: () => true,
        complete: async () => "",
        async *streamComplete() {
          yield "half a sen";
          throw new Error("request failed with status 429");
        },
      } as unknown as LlmProvider),
      candidate(
        "second",
        stub(TIERS, async () => "a whole different answer"),
      ),
    ];
    state.served = candidates[0];

    const provider = createDispatchingProvider(candidates, state);
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of provider.streamComplete({ model: "large", messages: [] })) {
          seen.push(chunk);
        }
      })(),
    ).rejects.toThrow("429");
    expect(seen).toEqual(["half a sen"]);
  });
});
