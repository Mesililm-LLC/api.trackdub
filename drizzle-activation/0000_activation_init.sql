CREATE TABLE `activations` (
	`id` text PRIMARY KEY NOT NULL,
	`license_id` text NOT NULL,
	`fingerprint_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`activated_at` text DEFAULT (datetime('now')) NOT NULL,
	`released_at` text,
	FOREIGN KEY (`license_id`) REFERENCES `licenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activations_license_fingerprint_unique` ON `activations` (`license_id`,`fingerprint_hash`);--> statement-breakpoint
CREATE TABLE `licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`tier` text DEFAULT 'pro' NOT NULL,
	`buyer_email` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_machines` integer DEFAULT 2 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `licenses_key_hash_unique` ON `licenses` (`key_hash`);