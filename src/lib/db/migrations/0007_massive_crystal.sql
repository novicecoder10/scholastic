CREATE TABLE "author" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_key" text NOT NULL,
	"identity_kind" text NOT NULL,
	"orcid" text,
	"openalex_author_id" text,
	"display_name" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_author_key_unique" UNIQUE("author_key"),
	CONSTRAINT "author_orcid_unique" UNIQUE("orcid"),
	CONSTRAINT "author_openalex_author_id_unique" UNIQUE("openalex_author_id")
);
--> statement-breakpoint
CREATE TABLE "author_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias_author_key" text NOT NULL,
	"canonical_author_key" text NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_alias_alias_author_key_unique" UNIQUE("alias_author_key")
);
--> statement-breakpoint
CREATE TABLE "author_metrics_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_key" text NOT NULL,
	"source" text NOT NULL,
	"h_index" integer,
	"i10_index" integer,
	"works_count" integer,
	"cited_by_count" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "author_name_variant" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_key" text NOT NULL,
	"normalized_name" text NOT NULL,
	"display_name" text NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_author" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_key" text NOT NULL,
	"author_key" text NOT NULL,
	"position" integer NOT NULL,
	"raw_name" text NOT NULL,
	"orcid" text
);
--> statement-breakpoint
CREATE INDEX "author_display_name_idx" ON "author" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "author_alias_canonical_idx" ON "author_alias" USING btree ("canonical_author_key");--> statement-breakpoint
CREATE UNIQUE INDEX "author_metrics_key_source_idx" ON "author_metrics_cache" USING btree ("author_key","source");--> statement-breakpoint
CREATE UNIQUE INDEX "author_name_variant_key_name_idx" ON "author_name_variant" USING btree ("author_key","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "work_author_work_position_idx" ON "work_author" USING btree ("work_key","position");--> statement-breakpoint
CREATE INDEX "work_author_author_idx" ON "work_author" USING btree ("author_key");--> statement-breakpoint
CREATE INDEX "work_author_work_idx" ON "work_author" USING btree ("work_key");