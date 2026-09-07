# Accounts and library (sub-project #5) — Design

## Context

Sub-project **5 of 9** (see `ROADMAP.md`). The largest so far, and the first
where a mistake is a security bug rather than a quality problem.

Scholastic has no identity layer. `ROADMAP.md` lists "accounts, saved searches,
search history, and persistent research memory" under *Mid-term — needs its own
foundation-design pass first*, and every feature built so far has been designed
around its absence: chat has no persistence, synthesis state is
client-round-tripped, and #2 invented an anonymous signed-cookie session
specifically so uploads could work before accounts existed.

Two later sub-projects are blocked on this one:

- **#6 gamification** — credits need an owner and a durable balance.
- **#8 AI writer** — needs a library of sources to cite from.

### Decisions taken before design (2026-09-06)

1. **Auth** — better-auth 1.7.2 with email+password always available and OAuth
   enabled only when configured. Not a hand-rolled extension of #2's cookie,
   and not next-auth v4.
2. **Library scope** — saved papers, uploaded documents, and collections over
   both. Not saved searches or history; not notes and highlights.
3. **Anonymous use** — everything that works today keeps working with no
   account. Accounts add persistence and cross-device sync.

### Framework notes

Read before designing, per `AGENTS.md`:
`node_modules/next/dist/docs/01-app/02-guides/authentication.md` and
`.../04-functions/unauthorized.md`.

- Next 16 provides an `unauthorized()` interrupt and an `unauthorized.tsx`
  convention, but both are **experimental** behind
  `experimental.authInterrupts`. This design does not use them — see
  "Authorization responses" below.
- The guide's Data Access Layer pattern (a `verifySession()` chokepoint wrapped
  in React `cache()`, returning DTOs rather than raw rows) is adopted.

## Goals

- Real accounts, with email+password working against zero external services.
- A library holding saved papers, uploaded documents, and collections over both.
- Preserve anonymous use of everything that works today, and carry an anonymous
  session's uploads into an account on sign-up without data loss.
- Keep the project's contract that every dependency is optional — including,
  awkwardly, accounts themselves.

## Non-goals

- **No sharing or collaboration.** Collections carry an unguessable `publicId`
  so sharing is possible later without a migration, but nothing exposes it.
- **No teams, organizations, or roles.** One flat user model.
- **No public profiles.**
- **No Zotero/Mendeley/BibTeX import.** Export exists (see below); import is a
  parsing project of its own.
- **No saved searches and no search history.** Deferred deliberately: an
  automatic record of what a person researches is a privacy surface that needs
  its own retention, visibility, and opt-out design, not a table added in
  passing.
- **No notes or highlights.** Highlights need selection anchoring in the PDF,
  which #3 explicitly deferred; adding them here drags that work forward.
- **No password-strength theatre or account deletion workflows beyond a plain
  delete.**

---

## The central tension: two session systems

#2 built `scholastic_sid`, a signed anonymous cookie. better-auth brings its
own session cookie. These are **not duplicates and must not be merged.**

| Cookie | Identifies | Lifetime |
| --- | --- | --- |
| `scholastic_sid` (#2) | This **browser** | Exists whether or not anyone is signed in |
| better-auth session | This **user** | Exists only while signed in |

Collapsing them produces one of two bugs, both bad: uploads vanish on sign-out,
or the next person to use the browser inherits the previous user's library.

So the most important interface in this sub-project is a single resolver:

```ts
// lib/auth/owner.ts
export type Owner =
  | { kind: "user"; userId: string }
  | { kind: "anonymous"; sessionId: string };

export function resolveOwner(): Promise<Owner>;
```

**Every ownership check in the application goes through it.** No route handler
and no Server Component reads either cookie directly.

`document` (from #2) gains a nullable `userId` beside its existing
`ownerSessionId`. A row is owned by its `userId` when that is set, and by its
`ownerSessionId` otherwise.

### Adoption

On successful sign-in and sign-up:

```sql
UPDATE document
   SET user_id = $userId
 WHERE owner_session_id = $sessionId
   AND user_id IS NULL;      -- ← the entire security of this operation
```

That `WHERE user_id IS NULL` is not an optimization. Without it, a second person
signing in on a shared browser inherits the first person's documents.

Sign-out **rotates `scholastic_sid`**, so the next anonymous session starts
clean rather than resuming the departing user's device identity.

The four cases this must handle, each of which gets a test:

| Case | Expected |
| --- | --- |
| Anonymous with uploads signs up | Documents move to the new user |
| Existing user signs in on a fresh device | Nothing to claim; no error |
| A second user signs in on a browser that already used another account | Claims nothing — those rows have a `userId` |
| User signs out | Documents stay with the user; cookie rotates; the device sees an empty anonymous library |

---

## Authentication

**better-auth 1.7.2**, with its Drizzle adapter against the existing Postgres.
It declares `next: ^14 || ^15 || ^16` in peers, so the Next 16 compatibility
risk that motivated checking is not present.

It owns four tables — `user`, `session`, `account`, `verification` — and the
parts that are quietly easy to get wrong: password hashing, session rotation,
CSRF, and login rate limiting (enabled explicitly, not left at default).

Email and password are always available. GitHub and Google OAuth register
**only when their client secrets are present**, which is the same conditional-
enablement pattern `lib/providers/registry.ts` already uses for search
providers.

### Accounts degrade to off

This is the awkward one, and worth stating rather than glossing.

Every dependency in this project is optional. Auth looks like the exception,
and it does not have to be: **when `BETTER_AUTH_SECRET` is unset, accounts are
disabled entirely.** `/login` and `/signup` return 503, no auth UI renders, the
`Library` nav item shows the anonymous view, and the application behaves
precisely as it does today. A self-hosted single-user instance never has to
configure auth at all.

Likewise, email verification and password reset need SMTP. With none
configured, verification is off and password reset states plainly that it is
unavailable on this instance. Sign-up is **not** blocked by an unconfigured
mailer — that would make an optional dependency mandatory through the back
door.

### Authorization responses

Three surfaces, three deliberately different answers:

| Surface | Unauthenticated / unauthorized |
| --- | --- |
| Library pages (`/library`, `/collections/*`) | Redirect to `/login?next=…` |
| API routes (`/api/library/*`) | 401 JSON |
| #2's capability resources (`/api/documents/[id]`) | **404**, unchanged — a 403 confirms the id exists |

`unauthorized()` is not used. It is experimental, it requires a config flag,
and a 401 error page is the wrong experience for a library page a user simply
has not signed into yet.

### Data Access Layer

```
lib/auth/
  config.ts      better-auth instance; conditional OAuth registration
  dal.ts         verifySession() wrapped in React cache(); requireUser()
  owner.ts       resolveOwner(); claimAnonymousSession()
  dto.ts         PublicUser — never the raw row, never the password hash
```

Nothing outside `lib/auth/` reads a cookie. Nothing returns a raw `user` row to
a client component.

---

## Data model

better-auth owns `user`, `session`, `account`, `verification`. Three new tables
are ours:

```
collection
  id, publicId, userId, name, description, createdAt, updatedAt
  unique(userId, name)
  index(userId, updatedAt)

saved_item
  id, userId
  itemType     'work' | 'document'
  workKey      text null
  documentId   text null
  workSnapshot jsonb null        -- CanonicalWork as it was at save time
  note         text null         -- one short line, not a notes feature
  savedAt
  check  (itemType = 'work'     AND workKey    IS NOT NULL AND documentId IS NULL)
      OR (itemType = 'document' AND documentId IS NOT NULL AND workKey    IS NULL)
  unique(userId, workKey)      where workKey    is not null
  unique(userId, documentId)   where documentId is not null

collection_item
  collectionId, savedItemId, position, addedAt
  unique(collectionId, savedItemId)
```

**Why `saved_item` is polymorphic** rather than two parallel tables:
collections must hold both papers and uploads, and a `collection_item` with two
nullable parent columns is strictly worse than one layer of indirection through
a single saved-item identity. The CHECK constraint keeps the polymorphism
honest at the database level rather than in application code.

**Why a work is snapshotted.** The `work` table exists, but `persistWorks`
writes to it un-awaited and best-effort — for any given paper the row may be
stale or simply absent, especially on an instance whose database was down when
the search ran. A saved paper that renders as an empty row because a provider
changed its record is a broken feature, so the `CanonicalWork` at save time is
stored on the row and rendered from there.

`publicId` on `collection` is unguessable and unused. It exists so that
sharing, if it is ever built, is a feature rather than a migration.

---

## UI

| Route | Contents |
| --- | --- |
| `/login`, `/signup` | Minimal forms on #1's tokens. OAuth buttons appear only for configured providers |
| `/library` | Tabs: Papers · Documents · Collections |
| `/library/collections/[publicId]` | One collection, reorderable, with export |

`Library` graduates from `TopNav`'s `SoonLink` to a real `NavLink`, and the
placeholder `—` avatar circle becomes a real account menu.

A `Save` control joins `Cite` (#4) on `ResultCard` and in the reader header.

**Anonymous visitors still see Library** — their uploaded documents listed,
with a "sign in to keep these" note — rather than a hidden nav item. Hiding it
would make the app look smaller than it is and hide the uploads they already
have.

**Exporting a collection as BibTeX or RIS is one button.** #4 already wrote
those formatters against CSL-JSON; wiring a collection through them is close to
free and is the cheapest single thing that makes a library feel like a library
rather than a list.

---

## Testing

| Test | Covers |
| --- | --- |
| `owner.test.ts` | `resolveOwner` for both kinds; precedence of user over session |
| `adoption.test.ts` | All four adoption cases in the table above, including that a second user claims nothing |
| `savedItems.test.ts` | The CHECK constraint rejecting a malformed row; idempotent save; unsave; snapshot preserved when the live `work` row changes |
| `collections.test.ts` | Name uniqueness per user; reordering; cross-user access returns nothing rather than erroring |
| Route tests | 401 shape on `/api/library/*`; redirect on library pages; #2's document routes still 404 for a non-owner |
| Migration test | #2 documents carrying only `ownerSessionId` still resolve after the `userId` column is added |

### Escalation on end-to-end coverage

#3's spec noted that the absence of Playwright would start costing real time.
This is the point to act on it rather than repeat it.

Sign-in, sign-out, cookie rotation, and anonymous-session adoption are
multi-request, cookie-dependent flows. They are the canonical case for
end-to-end testing, and unlike every gap named so far, a bug in them is a
**security** bug: one user seeing another's library. A node-level unit test can
prove `resolveOwner` returns the right shape; it cannot prove the cookie
actually rotated in a browser.

**Recommendation: add Playwright before implementing #5, not after #9.** The
alternative is shipping the app's only security-relevant flows with no test
that exercises them the way a user does. That is a decision to make knowingly,
not by omission.

---

## Dependencies

- **`better-auth`** (1.7.2) — the one substantial addition.
- **Playwright** (dev) — per the recommendation above.

New environment variables, all optional in the sense that their absence
disables a feature cleanly rather than breaking the app:

| Variable | Effect when unset |
| --- | --- |
| `BETTER_AUTH_SECRET` | Accounts disabled entirely; app runs anonymous-only |
| `BETTER_AUTH_URL` | Defaults to the request origin |
| `GITHUB_CLIENT_ID` / `_SECRET` | GitHub sign-in not offered |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in not offered |
| `SMTP_URL` | Email verification off; password reset unavailable with a clear message |

All documented in `.env.example` and `SETUP.md`, following the existing
"required to enable" convention.
