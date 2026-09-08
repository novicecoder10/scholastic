# Credits and Sponsorship — Design

Date: 2026-09-06
Sub-project: #6 of 9
Depends on: #5 (accounts and library) for `userId`
Status: approved, not implemented

## What this is

Scholastic is a community service. Credits are not a rate limiter wearing a
game costume, and they are never purchasable. They are how a **shared, donated
pool of AI capacity** is allocated fairly among researchers.

Every new researcher starts with a generous grant so they can do real work on
day one. Credits are replenished by genuine scholarly contribution and by a
recurring baseline allowance. Separately, people and companies who want to
support the commons contribute capacity freely — with no tier, no priority, and
no influence over who gets served.

The design problem is **stewardship of a shared resource**, not metering.

## Three concepts, deliberately separate

Conflating these is the failure mode this design exists to avoid.

| Concept | What it is | Unit |
| --- | --- | --- |
| Capacity | Real API keys and the quota behind them | provider tokens |
| Credits | A user's claim on that capacity | credits |
| Contribution | What earns a claim | verified works / reviews |

Capacity is finite and externally denominated. Credits are an internal
allocation currency. Contribution is the input that mints them. Keeping them
separate means the exchange rate can change without rewriting anything, and a
capacity shortfall never silently corrupts a user's balance.

## Capacity pool

```
capacity_source
  id               text primary key
  label            text not null            -- "Operator (Groq)", "Acme Labs"
  providerId       text not null            -- anthropic | groq | sambanova | ...
  credentialRef    text not null            -- NAME of an env var, never a key
  sponsorName      text                     -- null for operator-owned capacity
  sponsorUrl       text
  isPublic         boolean not null default false
  monthlyTokenCap  bigint                   -- null = uncapped
  tokensUsedPeriod bigint not null default 0
  periodStartsAt   timestamptz not null
  status           text not null            -- active | exhausted | disabled
  index(status, providerId)
```

**Keys are never stored in the database.** `credentialRef` holds the *name* of
an environment variable; the secret itself lives in the environment exactly
like every other credential in this project. A sponsor onboarding flow that
accepts a pasted API key into a web form is an explicit non-goal — it would be
the single worst thing this project could build, and the reason is written here
so it does not get re-litigated as a convenience feature later.

Sponsorship in v1 is therefore **operator-mediated**: a sponsor offers capacity,
the operator adds the key to the environment and inserts a `capacity_source`
row describing it. This is slower than self-serve and it is correct.

### Provider selection

`getLlmProviderForTask(tier)` in `lib/ai/llm/index.ts` is currently a stub that
ignores its argument and returns best-available — it is the source of the
repo's one standing eslint `_tier` warning. This sub-project gives it its
purpose:

1. Filter `capacity_source` to `status = 'active'` sources whose provider can
   serve `tier` and whose `tokensUsedPeriod < monthlyTokenCap`.
2. **Prefer sponsor capacity over operator capacity**, so donations are
   actually consumed rather than sitting behind the operator's own key.
3. Among equals, fall back to the existing static preference order
   (Anthropic > Groq > SambaNova > Mistral > OpenRouter > Gemini) with its
   live-verified rationale intact.
4. No eligible source → the existing `NO_LLM_PROVIDER_MESSAGE` 503 path,
   unchanged.

`recordUsage` gains the selected `sourceId` so `tokensUsedPeriod` is
incremented against the source that actually served the request. A source that
crosses its cap flips to `exhausted` and is skipped until `periodStartsAt`
rolls over.

## Credit ledger

Append-only. One row per event, each with a reason and the balance it produced.

```
credit_ledger
  id           bigserial primary key
  userId       text not null references user(id) on delete cascade
  delta        integer not null          -- signed
  reason       text not null
  detail       jsonb                     -- feature, tokens, workId, ...
  balanceAfter integer not null
  idempotencyKey text                    -- unique per grant source
  createdAt    timestamptz not null default now()
  index(userId, createdAt desc)
  unique(userId, idempotencyKey) where idempotencyKey is not null

credit_balance
  userId    text primary key references user(id) on delete cascade
  balance   integer not null
  updatedAt timestamptz not null
```

`reason` ∈ `welcome_grant | periodic_replenishment | publication_verified |
peer_review_verified | spend | refund | operator_adjustment`.

The ledger is the source of truth; `credit_balance` is a materialized
convenience updated in the same transaction, with a reconciliation check
(`sum(delta) == balance`) exercised in tests and available as a maintenance
query.

A bare balance column can tell a user *12* but never *why 12*. In a commons,
unexplainable accounting is a trust problem, not a UX problem — which is why
the ledger, not the counter, is canonical.

## Costing

`recordUsage(provider, tier, feature)` already returns an `onUsage` callback
carrying `inputTokens` and `outputTokens`. Cost is a pure function of actual
consumption:

```ts
// lib/credits/cost.ts — pure, no I/O
export function creditsForUsage(
  tier: string,
  inputTokens: number,
  outputTokens: number,
): number;
```

**Free forever, never debited:** search and provider fan-out, dedupe, merge,
ranking, filtering, citation formatting (#4 is fully deterministic), the
citation graph, PDF reading, saving, and collections. These cost no incremental
money and they are the product.

**Metered:** LLM calls (summary, chat turn, synthesis, paraphrase, topic
labelling, #7's extraction) and hosted embeddings. Local
`@xenova/transformers` embeddings stay free — they cost CPU, not money.

Two rules:

- The cost of an expensive action is shown **before** it runs.
- The debit happens on **successful completion, using actual tokens**. A failed,
  refused, or interrupted call is never charged.

### Reserve, then reconcile

`recordUsage` is documented as intentionally non-blocking and swallows all
errors: "must never affect the response." Debiting must be reliable. These are
resolved rather than compromised:

1. **Pre-flight** (blocking, before the LLM call): read balance, compare to a
   conservative estimate for the operation. Insufficient → refuse *before*
   spending anything, with a clear message. This is the only place credits can
   block a request.
2. **Debit** (non-blocking, on completion): the `onUsage` callback writes the
   `spend` row with real token counts. If that write fails, it is logged and
   dropped — exactly the current contract.

The asymmetry is deliberate. A dropped debit undercharges by one operation. A
debit that breaks a response the user already received is a bug they experience.
Undercharging is the cheaper failure, and pre-flight bounds how much of it can
accumulate.

## Earning

| Source | Amount | Idempotency |
| --- | --- | --- |
| Welcome grant | generous, env-tunable, published | one per user |
| Periodic replenishment | monthly top-up **to a floor** | `replenish:<yyyy-mm>` |
| Verified publication | per indexed work, diminishing | `work:<openAlexId>` |
| Verified peer review | per review record | `review:<orcidPutCode>` |

The welcome grant is sized so a new researcher can complete a genuine
literature review on day one. The monthly figure tops a balance **up to** a
floor rather than adding to it, so credits cannot be accrued by inactivity.

**Diminishing returns** on publications past a threshold: a prolific senior
author should not accumulate a large claim on a shared pool they cannot spend
while an early-career researcher runs dry. This is a fairness decision, stated
plainly rather than hidden in a constant.

**Credits are never earned by in-app activity.** Farming a commons is farming
other researchers.

### ORCID verification

Ownership of an ORCID iD is proven by **ORCID OAuth** (`ORCID_CLIENT_ID`,
`ORCID_CLIENT_SECRET`). A self-asserted iD typed into a box proves nothing and
would be trivially abused. With the iD verified:

- Publications come from **OpenAlex**, which the app already queries, filtered
  by author ORCID. No new provider.
- Peer reviews come from the ORCID record's own review section.

Grants run on demand (user clicks "check for new contributions") and are
idempotent by the keys above, so re-running awards nothing twice.

If ORCID OAuth is not configured, earning is simply off; the welcome grant and
replenishment carry everyone. Same degradation contract as every other optional
credential.

## Degradation

| Condition | Behavior |
| --- | --- |
| Accounts disabled (#5 off) | Credits off entirely; instance is unmetered |
| Postgres unreachable | **Fail open** — AI features run unmetered, logged |
| No sponsor capacity | Operator capacity serves everyone |
| No capacity at all | Existing 503, unchanged |
| Balance at zero | Free surface stays fully usable |

**Fail open is a chosen trade-off, not an oversight.** A commons that refuses
service because its bookkeeping is offline is worse than one that occasionally
undercounts.

**Zero balance is not a broken app.** Search, reading, citation generation,
collections, and the graph all keep working — the AI surfaces show what they
cost and when the balance replenishes.

## Anonymous users

Anonymous visitors have no identity that can hold a balance, so they hold none.
They get a modest per-session allowance for AI features, keyed on #2's
`scholastic_sid`, drawn **only from operator capacity, never from sponsor
capacity**.

Without this, "use it logged out" is the hole that makes the entire system
decorative. Sponsors donate capacity for researchers, not for an unauthenticated
firehose.

## Visibility

`/credits` (signed in only) shows the balance, the ledger in plain language,
what each action costs, and current pool health.

`/sponsors` (public) lists `isPublic` sources with name, link, and aggregate
contribution. No per-user data ever appears there.

**No leaderboard, no public badge, no profile, no comparison surface anywhere.**
This is a hard constraint, not a v1 simplification. A credit score attached to
researchers and shown publicly is a reputation metric, and academia's existing
reputation metrics (h-index, citation counts) have a well-documented history of
being gamed — citation cartels, salami publishing, coercive citation. Keeping
balances private removes the incentive structurally rather than policing it.

## Modules

| Path | Purpose |
| --- | --- |
| `lib/credits/cost.ts` | Pure token→credit function |
| `lib/credits/ledger.ts` | Append row + update balance, one transaction |
| `lib/credits/grants.ts` | Welcome, replenishment, contribution grants |
| `lib/credits/preflight.ts` | Estimate + balance check before an LLM call |
| `lib/capacity/sources.ts` | Source selection, cap accounting, period rollover |
| `lib/orcid/oauth.ts` | ORCID OAuth flow |
| `lib/orcid/contributions.ts` | OpenAlex works + ORCID reviews → grantable items |
| `app/credits/page.tsx` | Private balance and ledger |
| `app/sponsors/page.tsx` | Public sponsor list |
| `app/api/credits/check-contributions/route.ts` | On-demand grant run |

`lib/ai/llm/index.ts` and `lib/ai/llm/usage.ts` are modified, not replaced.

## Testing

Node-environment vitest, consistent with the existing 280-test suite.

- `cost.ts`: token→credit mapping, rounding, per-tier rates.
- `ledger.ts`: `sum(delta) == balance` after arbitrary sequences; idempotency
  key rejects a duplicate grant; a failed debit leaves the ledger consistent.
- `preflight.ts`: refuses below estimate with the user-facing message; permits
  at exactly the estimate.
- No debit on a failed or interrupted call; debit uses actual, not estimated,
  tokens.
- `grants.ts`: welcome grant once per user; replenishment tops **to** the floor
  and is a no-op above it; the same OpenAlex work id twice grants once;
  diminishing-returns curve at the threshold boundary.
- `sources.ts`: sponsor capacity preferred; an exhausted source is skipped;
  period rollover resets `tokensUsedPeriod`; no eligible source → 503.
- Fail-open: with the DB unavailable, an AI call still succeeds and logs.

## Non-goals

- Purchasing credits, or any payment path whatsoever.
- Paid tiers, priority queues, or any sponsor-purchased advantage.
- Transferring or gifting credits between users.
- Self-serve API key upload.
- Leaderboards, public badges, or public profiles.
- Credits for anonymous users (they get a flat allowance instead).

## New configuration

Env: `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `CREDITS_WELCOME_GRANT`,
`CREDITS_MONTHLY_FLOOR`, `CREDITS_ANON_SESSION_ALLOWANCE`.

No new runtime dependencies — ORCID OAuth is a plain OAuth 2 code flow and
OpenAlex is already a configured provider.
