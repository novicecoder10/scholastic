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

- **No-auth providers** (OpenAlex, Crossref, arXiv, Europe PMC, DOAJ) need nothing — they
  work out of the box. (OpenCitations is not part of the search fan-out at all — its API has
  no keyword-search capability; see `KNOWN_LIMITATIONS.md`.)
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
- **`OPENCITATIONS_ACCESS_TOKEN`** (optional): raises the rate limit on citation-graph
  enrichment (`GET /api/works/[workKey]/citations`). Works anonymously without it. Request one
  at https://opencitations.net/accessToken

**Leaving any of the above unset does not break the app.** The corresponding provider simply
reports itself as disabled (visible at `/api/health/providers`) and is excluded from the
fan-out — search continues to work with whatever providers are configured.

### AI features (Milestone 2)

- **`OPENAI_API_KEY`** (optional): when set, semantic search (`?mode=semantic`) and AI
  summaries' embedding step use OpenAI's `text-embedding-3-small` (truncated to 384
  dimensions). When unset, a **local** embedding model
  (`@xenova/transformers`, `Xenova/all-MiniLM-L6-v2`) is used instead — no key needed, but it
  downloads a small (~90MB) model to disk the first time it's used, and CPU inference is
  noticeably slower per-request than the hosted API (observed: tens of seconds for a
  first-time batch of ~90 uncached candidates; subsequent searches reusing already-embedded
  candidates are fast — see `KNOWN_LIMITATIONS.md`). Semantic search works correctly either
  way; this only changes which backend computes the vectors. Get a key at
  https://platform.openai.com/api-keys
- **At least one LLM key is required** to enable AI summaries, chat, query understanding, and
  citation reasoning (Milestone 3) — there is no local fallback for LLM tasks (a locally-run
  model can't approach usable quality for this on typical hardware). Without any of them, the
  affected endpoints return a clear `503` rather than breaking anything else. Six backends are
  supported, all sharing one selection function (`getActiveLlmProvider()`,
  `lib/ai/llm/index.ts`) — preferred in this order when multiple are configured:
  1. **Anthropic** — get a key at https://console.anthropic.com/
  2. **Groq** — a genuine free tier, fast inference. Get a key at https://console.groq.com/keys
  3. **SambaNova** — works well, but bills per-token against the account (not a true free
     tier). Get a key at https://cloud.sambanova.ai/apis
  4. **Mistral** — same, bills per-token. Get a key at https://console.mistral.ai/api-keys
  5. **OpenRouter** — a genuine free tier (some Llama/Gemma/Nemotron variants etc. are free to
     call). The free-model roster changes over time; check current availability at
     https://openrouter.ai/models?max_price=0. Get a key at https://openrouter.ai/keys
  6. **Google Gemini** (via its OpenAI-compatibility endpoint) — get a key at
     https://aistudio.google.com/apikey. Note: a valid key doesn't guarantee a working quota —
     the free tier is a per-Google-Cloud-project allowance that can be zero depending on your
     account's configuration.

  Each backend's default cheap/capable models are overridable via `<PROVIDER>_MODEL_CHEAP`/
  `<PROVIDER>_MODEL_CAPABLE` env vars (see `.env.example`) if a default model is retired.

### More AI features (Milestone 3)

Built on the same LLM provider layer above — no new credentials:

- **Conversational search** (`POST /api/query-understanding`) — the search bar tries this first
  on submit; it rewrites natural-language input into a search query/mode, or asks one
  clarifying question if the input is genuinely too vague. Falls back to a literal keyword
  search automatically if no LLM is configured or the call fails.
- **Interactive citation graph** — a "Graph view" toggle inside each result's "Citation graph"
  disclosure. No new credentials; uses the same OpenCitations/Semantic Scholar sources as the
  list view, plus a new `GET /api/citations/by-doi?doi=` route for expanding nodes beyond the
  first ring (papers only ever reached via a citation edge, never searched for directly).
- **Multi-paper synthesis chat** — a "Synthesize across these results" entry point above the
  result list, reasoning across the current page's results (not the whole corpus) via the same
  `/api/chat` route.
- **Citation reasoning** — click an edge in the graph view to ask why that citation exists.

### Document uploads and the reader (sub-projects #2 and #3)

Uploading a PDF needs two things beyond the database:

```bash
# Signs the cookie that owns uploaded documents.
SESSION_SECRET=$(openssl rand -hex 32)

# Where uploaded PDFs are written. Defaults to .uploads/ (gitignored).
UPLOAD_DIR=
```

`SESSION_SECRET` is optional in the sense that the app still starts without it — a random
per-process secret is minted and a warning is logged. But every uploaded document becomes
permanently unreachable the moment the server restarts, so set it anywhere you intend to keep
uploads.

Unlike every other database-backed feature, uploads cannot degrade gracefully without
Postgres: there is nowhere else to put the extracted chunks, so `POST /api/documents` returns
a 503 when the database is unreachable.

The reader at `/reader` needs no further configuration. Its PDF viewer loads the pdf.js worker
from `public/pdf.worker.min.mjs`, which `pnpm install` copies out of the installed
`pdfjs-dist` (`scripts/copy-pdf-worker.mjs`, wired to `postinstall`). The file is gitignored
because it must match the installed version; if the viewer ever fails to start, run
`node scripts/copy-pdf-worker.mjs` to refresh it.

### Accounts and the library (sub-project #5)

Accounts are optional, like every other dependency here. Leave `BETTER_AUTH_SECRET` unset and
the feature is simply off: `/login` and `/signup` answer 503, no auth UI renders, and uploads
keep belonging to the browser session. A single-user self-hosted instance never has to
configure any of this.

```bash
# Turns accounts on. Generate one with: openssl rand -hex 32
BETTER_AUTH_SECRET=

# The origin the app is served from. Optional in development; set it in production.
BETTER_AUTH_URL=https://scholastic.example.com

# Comma-separated extra origins (a second domain, a preview deployment).
BETTER_AUTH_TRUSTED_ORIGINS=
```

better-auth rejects requests from any origin it was not told about — a sign-in form served
from an unlisted host answers "Invalid origin". Outside production, `http://localhost:*` and
`http://127.0.0.1:*` are trusted automatically so `pnpm dev` works on whatever port is free.
In production nothing is wildcarded: every trusted origin is one you named.

OAuth and email are both opt-in, and a missing one is absent rather than broken:

```bash
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SMTP_URL=
```

With no `SMTP_URL`, email verification is **off** — requiring it with nowhere to send mail
would lock every new account out permanently — and password reset says so rather than
pretending to send.

Sign-in, sign-up and password reset are rate limited per address (20/minute for credentials,
5/minute for reset). There is deliberately no switch to turn that off.

**Anonymous uploads are adopted on sign-up and sign-in.** Documents uploaded before you had an
account are claimed by the account you create, but only while they still have no owner — the
claim filters on `user_id IS NULL`, so a second person signing in on a shared browser can
never inherit the first person's uploads. Signing out rotates the `scholastic_sid` cookie for
the same reason.

### Credits and sponsorship (sub-project #6)

Credits allocate a shared pool of donated AI capacity. They are never purchasable and never
earned by using the app. Metering only happens when accounts are enabled; on an instance with
no `BETTER_AUTH_SECRET`, AI features run unmetered exactly as before.

Everything is optional and defaulted:

```bash
CREDITS_WELCOME_GRANT=500           # one per account, ever
CREDITS_MONTHLY_FLOOR=300           # tops a balance UP TO this, never adds to it
CREDITS_ANON_SESSION_ALLOWANCE=40   # per browser, operator capacity only
CREDITS_PER_PUBLICATION=25
CREDITS_PER_PEER_REVIEW=25
CREDITS_DIMINISHING_THRESHOLD=10    # publications past this earn a halving rate
```

To grant credits for published work, register an ORCID application at
<https://orcid.org/developer-tools> with `<your origin>/api/orcid/callback` as the redirect URI:

```bash
ORCID_CLIENT_ID=
ORCID_CLIENT_SECRET=
ORCID_BASE_URL=https://sandbox.orcid.org   # optional, for testing
```

Without it, earning is simply off — the welcome grant and monthly top-up carry everyone.

#### Recording capacity

**No API key is ever stored in the database.** The `capacity_source` table records the _name_
of the environment variable holding each key. Sponsorship is therefore operator-mediated: a
sponsor offers capacity, you put the key in the environment and record a row. There is no web
form that accepts a pasted key, and there will not be one.

```bash
# Your own capacity
pnpm capacity --id operator-groq --label "Operator (Groq)" \
  --provider groq --credential GROQ_API_KEY

# A sponsor's, listed publicly on /sponsors, capped at 50M tokens a month
pnpm capacity --id acme-anthropic --label "Acme Labs (Anthropic)" \
  --provider anthropic --credential ACME_ANTHROPIC_API_KEY \
  --sponsor "Acme Labs" --url https://acme.example --public --cap 50000000

pnpm capacity --list
pnpm capacity --disable acme-anthropic
pnpm capacity --revive acme-anthropic   # clear a dormancy by hand
```

Sponsor capacity is preferred over operator capacity, so donations are actually consumed rather
than sitting unused. An instance with no rows at all keeps working — provider selection falls
back to the static preference order, and nothing is billed against a pool that doesn't exist.

##### Sponsors who cannot hand over a key

Two other shapes of donation, for the labs whose grant terms forbid exporting a credential and
for clusters with idle hours. Both are a URL rather than a key, and both go in the same table:

```bash
# A relay the sponsor runs and keeps custody of. Its bearer token is a secret
# like any other — named here, held in the environment, never in the database.
pnpm capacity --id mp-relay --label "Max Planck relay" --provider outpost   --base-url https://ai-relay.mp-lab.org/v1 --model mistral-large   --credential MP_RELAY_TOKEN --sponsor "Max Planck Research Group" --public

# A cluster node, donated weeknights. Times are UTC; days are ISO (Monday = 1).
# --credential is optional here: a node on a private network may need none.
pnpm capacity --id hpc-4 --label "University HPC 4" --provider node   --base-url https://hpc-node12.cs.edu/v1 --model deepseek-r1-distill-70b   --hours 18:00-06:00 --days 1,2,3,4,5
```

Both must speak the OpenAI chat-completions API — vLLM, SGLang, LiteLLM and Ollama all do. A
node serves one model, used for both the cheap and capable tiers, because that is what it has.

##### When a source runs dry

The pool fails over rather than failing. A source answering 401, 402, 403 or 429 is tripped
**dormant** and the request moves to the next one: five minutes for a rate limit, six hours for
a key being refused, since that needs you to look at it. `pnpm capacity --list` prints the clock
so you can tell the two apart, and `--revive` clears it early.

## 4. Run database migrations

```bash
pnpm db:migrate
```

## 5. Run the app

```bash
pnpm dev
```

Visit http://localhost:3000. Try a search, e.g. http://localhost:3000/?q=transformers.

The API is also directly usable, e.g.:

```bash
curl "http://localhost:3000/api/search?q=crispr&openAccessOnly=true&minCitations=100&page=1&perPage=10"
curl "http://localhost:3000/api/health/providers"

# Semantic (natural-language) search mode
curl "http://localhost:3000/api/search?q=papers+that+challenge+transformer+scaling+laws&mode=semantic"

# AI features — grab a workKey from a /api/search response's results[].workKey first
curl -X POST "http://localhost:3000/api/works/<workKey>/summary"
curl "http://localhost:3000/api/works/<workKey>/citations"
curl -X POST "http://localhost:3000/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is this paper about?"}],"context":"Title: ..."}'

# Conversational search (Milestone 3) — rewrites input or asks a clarifying question
curl -X POST "http://localhost:3000/api/query-understanding" \
  -H "Content-Type: application/json" \
  -d '{"input":"transformers"}'

# Citation graph expansion by bare DOI (never searched for directly)
curl "http://localhost:3000/api/citations/by-doi?doi=10.1038%2Fnature03347"

# Citation reasoning for a specific citing/cited pair
curl -X POST "http://localhost:3000/api/citations/reasoning" \
  -H "Content-Type: application/json" \
  -d '{"citingDoi":"10.1/citer","citedDoi":"10.1/cited"}'

# Multi-paper synthesis chat — same /api/chat route, with `works` instead of `context`
curl -X POST "http://localhost:3000/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What do these papers have in common?"}],"works":[{"workKey":"...","title":"...","abstract":"..."}]}'
```

## 6. Run tests / lint / build

```bash
pnpm test        # unit + integration (Vitest)
pnpm lint
pnpm build
pnpm test:e2e    # end-to-end (Playwright)
```

`pnpm test:e2e` builds the app and serves it on port 3100, because the flows it covers —
adoption, cookie rotation, cross-account isolation — only exist end to end. It needs a
database and a browser: `npx playwright install chromium` once, and a `DATABASE_URL`. The
library integration tests inside `pnpm test` skip themselves when no `DATABASE_URL` is set.

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
