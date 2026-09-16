CREATE TABLE `dub_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_name` text NOT NULL,
	`source_language` text NOT NULL,
	`target_language` text NOT NULL,
	`status` text DEFAULT 'Queued' NOT NULL,
	`input_media_path` text NOT NULL,
	`output_media_path` text,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`current_stage` text,
	`error_message` text,
	`duration_seconds` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dub_jobs_user_id_idx` ON `dub_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `dub_jobs_user_status_idx` ON `dub_jobs` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `dub_jobs_user_created_idx` ON `dub_jobs` (`user_id`,`created_at`);