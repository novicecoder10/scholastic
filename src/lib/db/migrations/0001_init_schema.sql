CREATE TABLE "provider_health_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"health" text NOT NULL,
	"circuit_state" text NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" real,
	"rate_limit_remaining" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"query_hash" text NOT NULL,
	"query_text" text NOT NULL,
	"filters" jsonb,
	"result_payload" jsonb NOT NULL,
	"provider_statuses" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "search_cache_query_hash_unique" UNIQUE("query_hash")
);
--> statement-breakpoint
CREATE TABLE "work" (
	"id" serial PRIMARY KEY NOT NULL,
	"doi" text,
	"title" text NOT NULL,
	"abstract" text,
	"year" integer,
	"venue" text,
	"authors" jsonb NOT NULL,
	"citation_count" integer,
	"is_open_access" boolean DEFAULT false,
	"pdf_url" text,
	"landing_page_url" text,
	"sources" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_doi_unique" UNIQUE("doi")
);
--> statement-breakpoint
CREATE INDEX "provider_health_provider_idx" ON "provider_health_snapshot" USING btree ("provider_id","recorded_at");--> statement-breakpoint
CREATE INDEX "search_cache_expires_idx" ON "search_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "work_title_idx" ON "work" USING btree ("title");--> statement-breakpoint
CREATE INDEX "work_year_idx" ON "work" USING btree ("year");