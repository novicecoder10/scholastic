CREATE TABLE "citation_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_key" text NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_ai_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_key" text NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_ai_summary_work_key_unique" UNIQUE("work_key")
);
--> statement-breakpoint
CREATE TABLE "work_embedding" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_key" text NOT NULL,
	"embedding_model_id" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work" ADD COLUMN "work_key" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "citation_cache_key_source_idx" ON "citation_cache" USING btree ("work_key","source");--> statement-breakpoint
CREATE INDEX "work_ai_summary_key_idx" ON "work_ai_summary" USING btree ("work_key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_embedding_key_model_idx" ON "work_embedding" USING btree ("work_key","embedding_model_id");--> statement-breakpoint
CREATE INDEX "work_embedding_vector_idx" ON "work_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
ALTER TABLE "work" ADD CONSTRAINT "work_work_key_unique" UNIQUE("work_key");