CREATE TABLE "venue" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue_key" text NOT NULL,
	"identity_kind" text NOT NULL,
	"issn_l" text,
	"openalex_source_id" text,
	"display_name" text NOT NULL,
	"type" text,
	"publisher" text,
	"is_in_doaj" boolean,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_venue_key_unique" UNIQUE("venue_key"),
	CONSTRAINT "venue_issn_l_unique" UNIQUE("issn_l"),
	CONSTRAINT "venue_openalex_source_id_unique" UNIQUE("openalex_source_id")
);
--> statement-breakpoint
CREATE TABLE "venue_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue_key" text NOT NULL,
	"source" text NOT NULL,
	"two_year_mean_citedness" real,
	"h_index" integer,
	"i10_index" integer,
	"works_count" integer,
	"cited_by_count" integer,
	"apc_usd" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work" ADD COLUMN "venue_key" text;--> statement-breakpoint
CREATE INDEX "venue_display_name_idx" ON "venue" USING btree ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_metrics_key_source_idx" ON "venue_metrics" USING btree ("venue_key","source");--> statement-breakpoint
CREATE INDEX "work_venue_key_idx" ON "work" USING btree ("venue_key");