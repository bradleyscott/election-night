CREATE TABLE `latest_state` (
	`election_year` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`publication_key` text,
	`payload` text NOT NULL,
	`source` text,
	`observed_at` text,
	`phase` text,
	`coverage` text,
	`model_version` integer,
	`config_version` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `scrape_snapshots` ADD `revision` integer;--> statement-breakpoint
ALTER TABLE `scrape_snapshots` ADD `publication_key` text;--> statement-breakpoint
ALTER TABLE `scrape_snapshots` ADD `model_version` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_snapshots_publication_key_unique` ON `scrape_snapshots` (`publication_key`);