ALTER TABLE "provider_health_snapshot" ADD COLUMN "rate_limit_limit" integer;--> statement-breakpoint
ALTER TABLE "provider_health_snapshot" ADD COLUMN "rate_limit_window_seconds" integer;--> statement-breakpoint
ALTER TABLE "provider_health_snapshot" ADD COLUMN "rate_limit_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_health_snapshot" ADD COLUMN "rate_limit_budget_remaining_usd" real;--> statement-breakpoint
ALTER TABLE "provider_health_snapshot" ADD COLUMN "api_pool" text;