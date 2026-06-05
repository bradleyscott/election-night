CREATE TABLE `electorate_results` (
	`scrape_id` integer NOT NULL,
	`electorate` text NOT NULL,
	`candidate` text NOT NULL,
	`party` text NOT NULL,
	`votes` integer NOT NULL,
	`is_predicted` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scrape_id`, `electorate`, `candidate`),
	FOREIGN KEY (`scrape_id`) REFERENCES `scrape_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `electorate_summary` (
	`scrape_id` integer NOT NULL,
	`electorate` text NOT NULL,
	`votes_counted` integer NOT NULL,
	`estimated_total_votes` real NOT NULL,
	`vote_pct_counted` real NOT NULL,
	`leading_candidate` text,
	`leading_party` text,
	`predicted_winner` integer DEFAULT 0 NOT NULL,
	`margin` integer,
	`margin_pct` real,
	`second_candidate` text,
	`second_party` text,
	`margin_of_error` real,
	PRIMARY KEY(`scrape_id`, `electorate`),
	FOREIGN KEY (`scrape_id`) REFERENCES `scrape_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `party_lists` (
	`scrape_id` integer NOT NULL,
	`party` text NOT NULL,
	`candidate` text NOT NULL,
	`list_rank` integer NOT NULL,
	`adjusted_rank` integer NOT NULL,
	`distance_from_cut` real,
	PRIMARY KEY(`scrape_id`, `party`, `candidate`),
	FOREIGN KEY (`scrape_id`) REFERENCES `scrape_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `party_vote_results` (
	`scrape_id` integer NOT NULL,
	`electorate` text NOT NULL,
	`party` text NOT NULL,
	`votes` integer NOT NULL,
	PRIMARY KEY(`scrape_id`, `electorate`, `party`),
	FOREIGN KEY (`scrape_id`) REFERENCES `scrape_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `party_vote_summary` (
	`scrape_id` integer NOT NULL,
	`party` text NOT NULL,
	`votes` integer NOT NULL,
	`seats` integer NOT NULL,
	`electorate_seats` integer NOT NULL,
	`list_seats` integer NOT NULL,
	PRIMARY KEY(`scrape_id`, `party`),
	FOREIGN KEY (`scrape_id`) REFERENCES `scrape_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scrape_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text
);
