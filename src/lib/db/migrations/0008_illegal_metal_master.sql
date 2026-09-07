CREATE TABLE "topic_label_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_hash" text NOT NULL,
	"embedding_model_id" text NOT NULL,
	"label" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "topic_label_hash_model_idx" ON "topic_label_cache" USING btree ("cluster_hash","embedding_model_id");