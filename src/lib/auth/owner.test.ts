import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifySession, getOrCreateSessionId, readSessionId, update, set, where, returning } =
  vi.hoisted(() => ({
    verifySession: vi.fn(),
    getOrCreateSessionId: vi.fn(),
    readSessionId: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  }));

vi.mock("@/lib/auth/dal", () => ({ verifySession: () => verifySession() }));
vi.mock("@/lib/documents/session", () => ({
  getOrCreateSessionId: () => getOrCreateSessionId(),
  readSessionId: () => readSessionId(),
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ update }),
}));

import { claimAnonymousSession, readOwner, resolveOwner } from "@/lib/auth/owner";

/** Drizzle's condition objects are cyclic, so JSON.stringify is out. Walking
 * the query chunks and collecting the literal SQL fragments is enough to prove
 * which clauses are present. */
function describePredicate(node: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  (function walk(value: unknown) {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    const record = value as Record<string, unknown>;
    if (typeof record.value === "string") parts.push(record.value);
    if (typeof record.name === "string") parts.push(record.name);
    for (const nested of Object.values(record)) walk(nested);
  })(node);
  return parts.join(" ").toLowerCase();
}

function chainReturning(rows: unknown[]) {
  returning.mockResolvedValue(rows);
  where.mockReturnValue({ returning });
  set.mockReturnValue({ where });
  update.mockReturnValue({ set });
}

describe("resolveOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers the signed-in user over the browser session", async () => {
    verifySession.mockResolvedValue({ id: "user-1" });
    getOrCreateSessionId.mockResolvedValue("sess-1");

    expect(await resolveOwner()).toEqual({ kind: "user", userId: "user-1" });
    // The browser cookie is not even consulted — user identity wins outright.
    expect(getOrCreateSessionId).not.toHaveBeenCalled();
  });

  it("falls back to the anonymous browser session", async () => {
    verifySession.mockResolvedValue(null);
    getOrCreateSessionId.mockResolvedValue("sess-1");

    expect(await resolveOwner()).toEqual({ kind: "anonymous", sessionId: "sess-1" });
  });
});

describe("readOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers the user, as resolveOwner does", async () => {
    verifySession.mockResolvedValue({ id: "user-1" });
    expect(await readOwner()).toEqual({ kind: "user", userId: "user-1" });
  });

  it("returns null for a first-time anonymous visitor with no cookie", async () => {
    // A Server Component cannot mint a cookie, so there is genuinely nothing
    // for this visitor to own yet.
    verifySession.mockResolvedValue(null);
    readSessionId.mockResolvedValue(null);
    expect(await readOwner()).toBeNull();
  });

  it("never mints a session cookie", async () => {
    verifySession.mockResolvedValue(null);
    readSessionId.mockResolvedValue("sess-1");
    await readOwner();
    expect(getOrCreateSessionId).not.toHaveBeenCalled();
  });
});

describe("claimAnonymousSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves this browser's unclaimed uploads to the account", async () => {
    chainReturning([{ documentId: "d1" }, { documentId: "d2" }]);
    expect(await claimAnonymousSession("user-1", "sess-1")).toBe(2);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
  });

  it("claims nothing on a fresh device", async () => {
    chainReturning([]);
    expect(await claimAnonymousSession("user-1", "sess-new")).toBe(0);
  });

  it("filters on both the session AND a null userId", async () => {
    // The `user_id IS NULL` clause is the entire security of this operation:
    // without it, a second person signing in on a shared browser would inherit
    // the first person's documents, whose rows still carry that session id.
    chainReturning([]);
    await claimAnonymousSession("user-2", "sess-1");
    // Two updates now: documents, then #7's matrices, which are owned the same
    // way and adopted by the same rule. The first is the one under test.
    expect(where).toHaveBeenCalledTimes(2);
    const predicate = describePredicate(where.mock.calls[0][0]);
    expect(predicate).toContain("owner_session_id");
    // The eq() clause names only owner_session_id, so user_id can only appear
    // via the isNull() clause. Its presence is the assertion.
    expect(predicate).toContain("user_id");

    // The matrix claim carries the same two clauses; a matrix adopted on
    // session id alone would hand the next person on a shared browser the
    // previous one's extraction work.
    const matrixPredicate = describePredicate(where.mock.calls[1][0]);
    expect(matrixPredicate).toContain("owner_session_id");
    expect(matrixPredicate).toContain("user_id");
  });

  it("never fails a sign-in when the claim itself errors", async () => {
    update.mockImplementation(() => {
      throw new Error("database down");
    });
    expect(await claimAnonymousSession("user-1", "sess-1")).toBe(0);
  });
});
