# Setup

## Prerequisites

- Node.js 20+ (this repo was built and tested against Node 20.20.2).
- [pnpm](https://pnpm.io) 9.x (this repo currently requires pnpm 9 — the pnpm 10+ line needs
  Node 22.13+, which this environment doesn't have. If you have Node 22.13+, a newer pnpm
  works too). Enable it via corepack:
  ```bash
  corepack enable
  corepack prepare pnpm@9 --activate
  ```
- Docker (for local Postgres), or an existing Postgres 15+ instance with permission to run
  `CREATE EXTENSION vector;`.

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start Postgres (with pgvector)

```bash
docker run --name scholastic-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d pgvector/pgvector:pg16
```

## 3. Configure environment

```bash
cp .env.example .env.local
```

At minimum, set `DATABASE_URL` to point at the Postgres instance above. Everything else is
optional for local development:

- **No-auth providers** (OpenAlex, Crossref, arXiv, Europe PMC, DOAJ, OpenCitations) need
  nothing — they work out of the box.
- **`OPENALEX_EMAIL` / `CROSSREF_EMAIL`** (optional): joins the "polite pool" for a higher
  rate limit. Any email you control is fine.
- **`SEMANTIC_SCHOLAR_API_KEY`** (optional): the provider works unauthenticated but is
  rate-limited harder without one. Request a key at
  https://www.semanticscholar.org/product/api#api-key
- **`CORE_API_KEY`** (required to enable the CORE provider): sign up for a free key at
  https://core.ac.uk/services/api
- **`UNPAYWALL_EMAIL`** (required to enable the Unpaywall provider): Unpaywall's usage policy
  requires an identifying email on every request — this is not a secret, just an email string.
- **`NCBI_EMAIL`** (required to enable the PubMed provider) and **`NCBI_API_KEY`** (optional,
  raises the NCBI rate limit from 3/s to 10/s): register at
  https://www.ncbi.nlm.nih.gov/account/settings/

**Leaving any of the above unset does not break the app.** The corresponding provider simply
reports itself as disabled (visible at `/api/health/providers`) and is excluded from the
fan-out — search continues to work with whatever providers are configured.

## 4. Run database migrations

```bash
pnpm db:migrate
```

## 5. Run the app

```bash
pnpm dev
```

Visit http://localhost:3000. Try a search, e.g. http://localhost:3000/?q=transformers.

## 6. Run tests / lint / build

```bash
pnpm test
pnpm lint
pnpm build
```

## Adding a new provider later

1. Create `src/lib/providers/<name>/adapter.ts` implementing the `ProviderAdapter` interface
   (`src/lib/providers/types.ts`) and a `mapper.ts` that converts the provider's response
   shape into `RawWork[]`.
2. Add the adapter to the `ALL_PROVIDERS` array in `src/lib/providers/registry.ts`.
3. If the provider needs credentials, read them from `process.env` inside the adapter and set
   `isConfigured()`/`meta.isEnabled` accordingly — document the new env var(s) in
   `.env.example` and above.
4. Write `adapter.test.ts` covering the response-mapping and (if keyed) both the
   configured and not-configured branches.

No other file needs to change — the orchestrator, health endpoint, and merge/rank layers all
iterate the registry generically.
