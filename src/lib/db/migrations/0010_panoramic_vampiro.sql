CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"transaction_type" text NOT NULL,
	"rule_id" text NOT NULL,
	"source_entity_id" text,
	"description" text,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "credit_tx_user_time_idx" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_dedupe_idx" ON "credit_transactions" USING btree ("user_id","rule_id","source_entity_id");