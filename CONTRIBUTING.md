# Contributing

Thanks for considering it. This document is short on ceremony and specific about the two
things that are easy to get wrong here.

## Running it

See [`SETUP.md`](./SETUP.md). The short version: Node 20+, pnpm, PostgreSQL with `pgvector`.

```bash
pnpm install
cp .env.example .env.local   # DATABASE_URL is the only required variable
pnpm db:migrate
pnpm dev
```

No API key is needed to work on search. Integration tests that need a database skip themselves
when `DATABASE_URL` is unset, so `pnpm test` passes on a bare checkout.

## Before opening a pull request

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

CI runs all four against a real Postgres. If you touched the UI, run `pnpm test:e2e` too — the
browser suite is written so that no test ever spends a credit.

## Two rules that are not style preferences

**Attribution is enforced, not suggested.** Any feature that generates text from papers must
delete what it cannot attribute rather than display it with a warning. `lib/manuscript/draftGuard.ts`
and `lib/deck/outline.ts` are the reference implementations; a new generator should import that
rule rather than restate it. A pull request that surfaces uncited model output will be asked to
change, however well it reads.

**No credential ever enters the database.** `capacity_source.credential_ref` stores the _name_ of
an environment variable. A web form, API endpoint, or table column that accepts a pasted API key
is a permanently recorded non-goal — see `SETUP.md` and `ARCHITECTURE.md` for why, including for
sponsors who cannot export a key at all.

## Reading order for a new area

[`ARCHITECTURE.md`](./ARCHITECTURE.md) explains the provider contract, the resilience layer and
the dedup/merge/ranking algorithm. [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) is worth
reading before filing a bug: several surprising behaviours are deliberate and explained there.
Design documents for each sub-project live in [`docs/specs/`](./docs/specs/).

## Tests

Vitest for unit and integration, Playwright for end-to-end. Provider adapters are tested against
recorded fixtures in `src/test/fixtures/`, with `msw` configured to fail on any unmocked request
— a test that reaches the network is a bug in the test.

Fixtures are all well-formed, which is a known blind spot: a real arXiv record with a repeated
`<arxiv:doi>` element once took down an entire search. When you add a parser, add the malformed
case too.
