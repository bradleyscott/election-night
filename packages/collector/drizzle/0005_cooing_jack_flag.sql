CREATE TABLE `webhook_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`election_year` text NOT NULL,
	`revision` integer,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`delivered_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_outbox_event_id_unique` ON `webhook_outbox` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_outbox_due` ON `webhook_outbox` (`status`,`next_attempt_at`);