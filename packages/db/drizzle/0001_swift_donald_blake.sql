CREATE TABLE IF NOT EXISTS "management_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] DEFAULT '{"keys"}' NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rate_limit_rpm" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "token_limit_daily" bigint;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "cost_limit_daily" numeric(12, 4);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "management_keys" ADD CONSTRAINT "management_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
