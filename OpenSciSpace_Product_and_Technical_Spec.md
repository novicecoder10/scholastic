# OpenSciSpace: Open-Source AI Research Workspace
## Product Requirements & Technical Specification Document

**Document ID:** `SPEC-OS-2026-V1`  
**Status:** Approved / Architecture Baseline  
**Target Architecture:** Modular Microservices + Agentic RAG  
**Target Release:** `v1.0.0-GA`  

---

## 1. Executive Summary & Product Objective

OpenSciSpace is an open-source, self-hostable scholarly research platform and AI copilot designed to eliminate workflow fragmentation across:
1. **Academic discovery** (semantic search, citation graphs, automated literature synthesis).
2. **Interactive reading** (dual-pane PDF copilot, formula extraction, table/figure interpretation).
3. **Systematic literature reviews** (tabular matrix extraction with verifiable source quotes).
4. **Reference management** (automatic metadata extraction, CSL-compliant bibliography generation).
5. **Academic authoring** (WYSIWYG manuscript editor with 1-click journal LaTeX/Typst exports).
6. **Ecosystem extensions** (Manifest V3 browser overlay and multi-agent synthesis).
7. **Commons-based capacity & sponsorship pool** (decoupled credit ledger and multi-tenant sponsor API).

The platform guarantees strict attribution: all generated insights link to primary source page coordinates and bounding boxes.

---

## 2. Architecture & Technical Topology

```
+-----------------------------------------------------------------------------------+
|                                Client Layer                                       |
|  Next.js 15 SPA (React, Tailwind CSS, TanStack Table) | Chrome/Firefox MV3 Extension|
+------------------------------------------+----------------------------------------+
                                           | HTTP / SSE / WebSockets
                                           v
+-----------------------------------------------------------------------------------+
|                         API Gateway & Orchestration                               |
|       FastAPI / Go Gateway | Supabase Auth / Ory Kratos | LiteLLM Proxy          |
+-------------------+----------------------+-------------------+--------------------+
                    |                      |                   |
                    v                      v                   v
+-----------------------+  +-----------------------+  +-----------------------------+
|    Parsing Engine     |  | Discovery & Search    |  |  Agentic RAG Engine         |
|  - GROBID (TEI-XML)   |  |  - OpenAlex Corpus    |  |  - LangGraph / LlamaIndex   |
|  - Marker / Surya OCR |  |  - Meilisearch (BM25) |  |  - Cross-Encoder Reranker   |
|  - PyMuPDF            |  |  - Qdrant (Dense BGE) |  |  - vLLM / Ollama Runtime    |
+-----------------------+  +-----------------------+  +-----------------------------+
                    |                      |                   |
                    +----------------------+-------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                    Capacity Dispatcher & Credit Ledger                            |
|  - Tri-Concept Ledger (Capacity != Credits != Contribution)                       |
|  - Sponsor Ingestion (Vault API, Zero-Trust Outpost, BYOB, Compute Nodes)         |
|  - Dynamic Rate Balancer & Circuit Breaker                                        |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                        Storage & Compilation Layer                                |
|   PostgreSQL / pgvector | S3-Compatible MinIO | Pandoc / Typst / XeLaTeX Engine   |
+-----------------------------------------------------------------------------------+
```

---

## 3. Detailed Functional Modules & Requirements

### Module 1: Literature Discovery & Synthesis (DISC)

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `DISC-01` | **Hybrid Search Engine** | Dual-channel retrieval executing sparse BM25 keyword matching and dense vector search (BGE-M3 / SPECTER2) over paper titles, abstracts, and claims, combined via Reciprocal Rank Fusion (RRF). | **P0** |
| `DISC-02` | **Synthesis Answer Box** | Synthesizes a structured 2–3 paragraph summary addressing the user's research query directly above search results, using top-k retrieved papers with clickable citation indices. | **P0** |
| `DISC-03` | **Bibliographic Faceting** | Filter candidate papers by year intervals, Open Access status (Gold, Green, Bronze, Closed), journal/conference quartile (SJR/JCR), PDF availability, and citation count. | **P0** |
| `DISC-04` | **Citation Graph Explorer** | Traverses forward citations, backward references, and bibliographic coupling to construct interactive 2D node-link network graphs of related literature. | **P1** |

---

### Module 2: Copilot & Interactive PDF Reader (READ)

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `READ-01` | **Dual-Pane Interactive Viewer** | Side-by-side view combining a PDF.js canvas layer with an SSE streaming chat interface. Clicking any citation jumps to and highlights the target bounding box on the page. | **P0** |
| `READ-02` | **Formula / Equation Parser** | Snip/crop tool for mathematical equations. Converts images to LaTeX via Surya OCR/Nougat and prompts the LLM to explain variable definitions and mathematical derivations. | **P1** |
| `READ-03` | **Table & Chart Explainer** | Bounding-box area extraction sent to a multimodal vision model (e.g., Qwen2-VL, Llama-3.2-Vision) to extract data tables into Markdown or summarize graphical plots. | **P1** |
| `READ-04` | **In-line Selection Actions** | Floating context menu on text selection with preset actions: *Explain Simply*, *Critique Methodology*, *Identify Assumptions*, *Summarize*, and *Translate (side-by-side)*. | **P0** |

---

### Module 3: Systematic Literature Review & Matrix Extraction (REVW)

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `REVW-01` | **Multi-Paper Matrix Grid** | Tabular interface where rows represent selected papers and columns represent analytical dimensions (*TL;DR*, *Sample Size*, *Dataset*, *Methodology*, *Key Findings*, *Limitations*). | **P0** |
| `REVW-02` | **Custom Extraction Prompts** | Users can add custom prompt columns (e.g., *"What evaluation metric was used?"*). The system concurrently extracts answers across all rows. | **P0** |
| `REVW-03` | **Verifiable Quote Spans** | Every extracted cell retains a direct quote from the source PDF. Clicking or hovering over a cell opens the source document at the exact page coordinate. | **P0** |
| `REVW-04` | **Matrix Export Pipeline** | Export extraction grids to formatted Excel (`.xlsx`), standard CSV, Markdown tables, or BibTeX bundles. | **P1** |

---

### Module 4: Reference Management & Workspace Library (REFM)

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `REFM-01` | **Automated Metadata Parsing** | Drag-and-drop PDF ingestion. Extracts metadata (DOI, title, authors, journal, volume, issue, year, references) within <2.5 seconds using GROBID. | **P0** |
| `REFM-02` | **CSL Citation Formatting** | Dynamically format reference lists and in-text markers into 9,000+ CSL citation styles using `citeproc-js` (APA 7th, IEEE, Nature, Harvard, Chicago, ACM). | **P0** |
| `REFM-03` | **Interoperable Sync** | Two-way import and export support for BibTeX (`.bib`), RIS, EndNote XML, and direct synchronization with Zotero/Mendeley libraries. | **P1** |

---

### Module 5: Academic Editor & Journal Formatter (EDIT)

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `EDIT-01` | **WYSIWYG Academic Editor** | Block-based rich text editor (Tiptap/Lexical) supporting mathematical notation (KaTeX/LaTeX), figures with numbered captions, tables, and nested section headers. | **P0** |
| `EDIT-02` | **Dynamic Reference Ingestion** | Typing `@` triggers an autocomplete dropdown of the user's library, inserting live-updating citation tokens that dynamically format the reference section. | **P0** |
| `EDIT-03` | **Journal Template Compilation** | One-click compilation of manuscripts into publisher-compliant PDFs (IEEE two-column, Elsevier, Springer Nature, ACM) using headless Typst / XeLaTeX. | **P1** |
| `EDIT-04` | **Attributed Writing Copilot** | Section drafting and paraphrasing assistant with scientific tone controls (*Formal*, *Concise*, *Literature Review*), strictly conditioned on linked references. | **P1** |

---

### Module 6: Browser Extension & Autonomous Agent (EXTN)

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `EXTN-01` | **Browser Copilot Overlay** | Manifest V3 extension for Chrome/Firefox that detects academic DOIs on arXiv, PubMed, Nature, and ScienceDirect, injecting a sidebar copilot directly onto the webpage. | **P1** |
| `EXTN-02` | **Autonomous Review Agent** | Autonomous multi-step agent: accepts a research question, decomposes sub-queries, screens abstracts from OpenAlex, extracts comparative attributes, and writes a draft review. | **P2** |

---

### Module 7: Credits, Sponsorship & Capacity Commons (SPON)

Credits are not a rate limiter in a game costume. They allocate a **shared, donated pool of AI capacity** among researchers, and they are never purchasable, never transferable, and never earned by using the app.

#### Three Core Decoupled Concepts

| Concept | What it is | Unit |
| :--- | :--- | :--- |
| **Capacity** | Real API keys and the quota behind them | Provider tokens |
| **Credits** | A user's claim on that capacity | Credits |
| **Contribution** | What earns a claim | Verified works / reviews |

Keeping these layers strictly decoupled allows the internal exchange rate to adapt dynamically without mutating the user credit ledger, ensuring that capacity shortfalls never corrupt researcher account balances.

| Req ID | Feature | Functional Description | Priority |
| :--- | :--- | :--- | :--- |
| `SPON-01` | **Decoupled Ledger Engine** | Ledger tracking user claims (Credits) strictly derived from peer-reviewed scientific contributions. Disallows purchase, transfer, or usage-based farming. | **P0** |
| `SPON-02` | **Sponsor Key Vault API** | Scoped authenticated endpoints for benefactors/labs to donate API keys under strict quotas (RPM, TPM, max monthly budget, model whitelist). | **P0** |
| `SPON-03` | **Zero-Trust Outpost Proxy** | Support for academic institutions that cannot export naked keys. Connects via mTLS to a sponsor-hosted relay container enforcing spend limits locally. | **P1** |
| `SPON-04` | **Compute Node Ingestion** | Ingestion of raw GPU nodes (vLLM / SGLang) donated by university HPC clusters on scheduled or off-peak hours. | **P1** |
| `SPON-05` | **Capacity Dispatcher & Breaker** | Real-time load-balancing across active sponsor capacity. Automatically flags depleted keys (`429`, `401`, `402`) as dormant and fails over without failing requests. | **P0** |
| `SPON-06` | **Attribution Telemetry** | Attaches voluntary sponsor acknowledgments to client response payloads (`"Capacity supported by <Sponsor>"`). | **P2** |

---

## 4. Sponsor Ingestion Architecture & API Specifications

### 4.1 Sponsor Vault Ingestion (`POST /api/v1/sponsorship/keys`)
Accepts direct API key contributions encrypted at rest using envelope encryption (KMS / HashiCorp Vault):

```json
{
  "sponsor_name": "Open Science Lab @ Zurich",
  "provider": "anthropic",
  "api_key": "sk-ant-api03-...",
  "constraints": {
    "allowed_models": ["claude-3-5-sonnet", "claude-3-haiku"],
    "max_tokens_per_day": 5000000,
    "max_spend_usd_month": 500.00,
    "concurrency_limit": 10
  },
  "watermark_attribution": "Donated by Open Science Lab"
}
```

### 4.2 Zero-Trust Outpost Registration (`POST /api/v1/sponsorship/outposts`)
Enables enterprise and grant-funded labs to retain key custody by exposing a scoped relay proxy:

```json
{
  "sponsor_name": "Max Planck Research Group",
  "outpost_url": "https://ai-relay.mp-lab.org/v1",
  "auth_token": "bearer_secret_established_out_of_band",
  "supported_models": ["meta-llama/llama-3.3-70b-instruct", "mistral-large"],
  "healthcheck_endpoint": "https://ai-relay.mp-lab.org/health"
}
```

### 4.3 Direct Compute Node Sponsoring (`POST /api/v1/sponsorship/endpoints`)
Registers scheduled HPC or local cluster capacity running OpenAI-compatible vLLM endpoints:

```json
{
  "sponsor_name": "University HPC Cluster 4",
  "base_url": "https://hpc-node12.cs.edu/v1",
  "model_served": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
  "schedule": {
    "active_hours_utc": "18:00-06:00",
    "days_of_week": [1, 2, 3, 4, 5, 6, 7]
  },
  "queue_depth_threshold": 8
}
```

---

## 5. Core Data Schemas

### 5.1 Document Chunk Schema (Vector & Coordinate Store)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "DocumentChunk",
  "type": "object",
  "properties": {
    "chunk_id": { "type": "string", "description": "Unique identifier (chk_UUID)" },
    "paper_id": { "type": "string", "description": "Foreign key to paper record" },
    "page_number": { "type": "integer", "minimum": 1 },
    "bounding_box": {
      "type": "object",
      "properties": {
        "x1": { "type": "number" },
        "y1": { "type": "number" },
        "x2": { "type": "number" },
        "y2": { "type": "number" }
      },
      "required": ["x1", "y1", "x2", "y2"]
    },
    "content_type": {
      "type": "string",
      "enum": ["narrative_text", "formula_latex", "table_markdown", "caption", "header"]
    },
    "raw_text": { "type": "string" },
    "normalized_markdown": { "type": "string" },
    "embedding_vector": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 1024,
      "maxItems": 1024
    }
  },
  "required": ["chunk_id", "paper_id", "page_number", "bounding_box", "content_type", "raw_text"]
}
```

### 5.2 Matrix Extraction Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MatrixExtractionCell",
  "type": "object",
  "properties": {
    "matrix_id": { "type": "string" },
    "paper_id": { "type": "string" },
    "column_id": { "type": "string" },
    "extracted_answer": { "type": "string" },
    "verbatim_quote": { "type": "string" },
    "source_chunk_ids": {
      "type": "array",
      "items": { "type": "string" }
    },
    "confidence_score": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0
    }
  },
  "required": ["matrix_id", "paper_id", "column_id", "extracted_answer", "verbatim_quote", "source_chunk_ids"]
}
```

---

## 6. End-to-End Processing Pipelines

### 6.1 Ingestion & Document Decomposition
1. **File Delivery:** Client streams PDF via multipart upload to S3-compatible storage.
2. **Structural Extraction:** GROBID extracts paper title, authors, affiliations, abstract, and bibliography to TEI-XML.
3. **Multimodal Layout Extraction:** Marker / Nougat processes formulas and tables into structured Markdown with coordinates.
4. **Bounding-Box Indexing:** Chunks are assigned bounding box metadata `(page, x1, y1, x2, y2)`.
5. **Dense & Sparse Indexing:** Text chunks are embedded using BGE-M3 and indexed into Qdrant; lexical tokens are indexed in Meilisearch.

### 6.2 RAG Retrieval, Capacity Dispatch & Synthesis Flow
1. **Balance & Rate Check:** Client submits a task. System verifies the researcher's balance in the Credit Ledger.
2. **Capacity Dispatch:** Capacity Dispatcher calculates the exchange rate (`1 credit = X provider tokens`) and routes to the most cost-effective, active sponsor capacity unit (Vault key, Outpost proxy, or HPC node).
3. **Query Decomposition:** Complex research questions are broken down into sub-queries.
4. **Hybrid Retrieval & Rerank:** Dense cosine similarity and sparse BM25 queries run concurrently; results are combined using RRF and reranked via `bge-reranker-v2-m3`.
5. **Attributed Generation:** The LLM generates the response with explicit citation tags:
   ```html
   <cite chunk_id="chk_01HR8X9">The hybrid model attained 98.4% accuracy.</cite>
   ```
6. **Telemetry & Attribution:** The system logs token deductions against the active sponsor quota and emits optional donor recognition in response headers.

---

## 7. Non-Functional Requirements & Deployment

* **Latency Targets:**
  * First-token SSE stream: `< 800ms`.
  * Search results across 10M records: `< 350ms`.
  * Single-paper GROBID metadata parse: `< 2.5s`.
* **Fault Tolerance & Circuit Breaking:**
  * Upstream sponsor quota exhaustion (`429`, `402`, `401`) triggers an instant circuit trip, routing subsequent requests to backup pools within `< 50ms`.
* **Self-Hosting & Air-Gapping:**
  * Provide single-node `docker-compose.yml` and enterprise Kubernetes Helm charts.
  * Zero external network dependencies when connected to local LLMs (Ollama / vLLM) and a local Qdrant instance.
* **Open Science Compliance:**
  * Support export to open standards (JATS XML, BibTeX, CSL-JSON).
