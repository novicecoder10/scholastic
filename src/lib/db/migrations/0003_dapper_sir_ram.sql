CREATE TABLE "citation_reasoning_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"citing_doi" text NOT NULL,
	"cited_doi" text NOT NULL,
	"reasoning" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "citation_reasoning_pair_idx" ON "citation_reasoning_cache" USING btree ("citing_doi","cited_doi");