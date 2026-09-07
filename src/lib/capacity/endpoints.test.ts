import { afterEach, describe, expect, it } from "vitest";
import {
  completionsUrl,
  endpointProvider,
  isEndpointProvider,
  parseWindow,
  withinSchedule,
  type EndpointRow,
} from "@/lib/capacity/endpoints";

function row(overrides: Partial<EndpointRow> = {}): EndpointRow {
  return {
    id: "hpc-4",
    providerId: "node",
    credentialRef: null,
    baseUrl: "https://hpc.example/v1",
    servedModel: "meta-llama/Llama-3.3-70B-Instruct",
    activeHoursUtc: null,
    activeDays: null,
    ...overrides,
  };
}

/** Thursday 2026-01-15 is a Thursday (ISO 4); the times below hang off it. */
const at = (iso: string) => new Date(iso);

describe("isEndpointProvider", () => {
  it("recognises the two endpoint kinds and nothing else", () => {
    expect(isEndpointProvider("outpost")).toBe(true);
    expect(isEndpointProvider("node")).toBe(true);
    expect(isEndpointProvider("anthropic")).toBe(false);
  });
});

describe("parseWindow", () => {
  it("reads a plain window", () => {
    expect(parseWindow("09:00-17:30")).toEqual({ startMinutes: 540, endMinutes: 1050 });
  });

  it("treats an unparseable window as no window rather than a closed one", () => {
    expect(parseWindow("evenings")).toBeNull();
    expect(parseWindow("25:00-26:00")).toBeNull();
    expect(parseWindow(null)).toBeNull();
  });

  it("treats a zero-length window as always open", () => {
    expect(parseWindow("18:00-18:00")).toBeNull();
  });
});

describe("withinSchedule", () => {
  it("is always open with no schedule at all", () => {
    expect(withinSchedule(row(), at("2026-01-15T03:00:00Z"))).toBe(true);
  });

  it("opens and closes on a plain window", () => {
    const scheduled = row({ activeHoursUtc: "09:00-17:00" });
    expect(withinSchedule(scheduled, at("2026-01-15T12:00:00Z"))).toBe(true);
    expect(withinSchedule(scheduled, at("2026-01-15T08:59:00Z"))).toBe(false);
    expect(withinSchedule(scheduled, at("2026-01-15T17:00:00Z"))).toBe(false);
  });

  it("stays open across midnight on a wrapping window", () => {
    const overnight = row({ activeHoursUtc: "18:00-06:00" });
    expect(withinSchedule(overnight, at("2026-01-15T23:00:00Z"))).toBe(true);
    expect(withinSchedule(overnight, at("2026-01-16T02:00:00Z"))).toBe(true);
    expect(withinSchedule(overnight, at("2026-01-16T07:00:00Z"))).toBe(false);
  });

  it("measures a wrapping window against the day it opened on", () => {
    // Weeknights only. Friday 22:00 is inside; Saturday 02:00 belongs to
    // Friday's window and is also inside; Sunday 02:00 belongs to Saturday's,
    // which was never donated.
    const weeknights = row({ activeHoursUtc: "18:00-06:00", activeDays: "1,2,3,4,5" });
    expect(withinSchedule(weeknights, at("2026-01-16T22:00:00Z"))).toBe(true);
    expect(withinSchedule(weeknights, at("2026-01-17T02:00:00Z"))).toBe(true);
    expect(withinSchedule(weeknights, at("2026-01-18T02:00:00Z"))).toBe(false);
  });

  it("honours a day list with no window", () => {
    const weekends = row({ activeDays: "6,7" });
    expect(withinSchedule(weekends, at("2026-01-17T12:00:00Z"))).toBe(true);
    expect(withinSchedule(weekends, at("2026-01-15T12:00:00Z"))).toBe(false);
  });
});

describe("completionsUrl", () => {
  it("completes an API root the way every OpenAI client is given one", () => {
    expect(completionsUrl("https://relay.example/v1")).toBe(
      "https://relay.example/v1/chat/completions",
    );
    expect(completionsUrl("https://relay.example/v1/")).toBe(
      "https://relay.example/v1/chat/completions",
    );
  });

  it("leaves an already-complete URL alone", () => {
    expect(completionsUrl("https://relay.example/v1/chat/completions")).toBe(
      "https://relay.example/v1/chat/completions",
    );
  });
});

describe("endpointProvider", () => {
  afterEach(() => {
    delete process.env.TEST_OUTPOST_TOKEN;
  });

  it("serves one model on both tiers", () => {
    const provider = endpointProvider(row());
    expect(provider?.models.cheap).toBe("meta-llama/Llama-3.3-70B-Instruct");
    expect(provider?.models.capable).toBe("meta-llama/Llama-3.3-70B-Instruct");
  });

  it("needs no credential for an unauthenticated node", () => {
    expect(endpointProvider(row())?.isConfigured()).toBe(true);
  });

  it("refuses a relay whose token the environment does not hold", () => {
    const relay = row({ providerId: "outpost", credentialRef: "TEST_OUTPOST_TOKEN" });
    expect(endpointProvider(relay)).toBeNull();
    process.env.TEST_OUTPOST_TOKEN = "present";
    expect(endpointProvider(relay)).not.toBeNull();
  });

  it("refuses an incomplete row rather than guessing a URL or a model", () => {
    expect(endpointProvider(row({ baseUrl: null }))).toBeNull();
    expect(endpointProvider(row({ servedModel: null }))).toBeNull();
  });

  it("is not used for a named provider", () => {
    expect(endpointProvider(row({ providerId: "anthropic" }))).toBeNull();
  });
});
