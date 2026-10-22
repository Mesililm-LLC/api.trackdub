CREATE TABLE "activations" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"tier" text DEFAULT 'pro' NOT NULL,
	"buyer_email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_machines" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "activations" ADD CONSTRAINT "activations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activations_license_fingerprint_unique" ON "activations" USING btree ("license_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX "activations_license_status_idx" ON "activations" USING btree ("license_id","status");