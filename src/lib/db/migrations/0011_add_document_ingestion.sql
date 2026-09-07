CREATE TABLE "document" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"owner_session_id" text NOT NULL,
	"filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" text NOT NULL,
	"page_count" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "document_chunk" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384),
	"embedding_model_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_owner_sha_idx" ON "document" USING btree ("owner_session_id","sha256");--> statement-breakpoint
CREATE INDEX "document_owner_created_idx" ON "document" USING btree ("owner_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunk_doc_index_idx" ON "document_chunk" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunk_doc_idx" ON "document_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_chunk_vector_idx" ON "document_chunk" USING hnsw ("embedding" vector_cosine_ops);
