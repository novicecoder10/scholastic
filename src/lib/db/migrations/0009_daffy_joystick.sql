CREATE TABLE "llm_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"feature" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" real,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_usage_provider_recorded_idx" ON "llm_usage" USING btree ("provider_id","recorded_at");