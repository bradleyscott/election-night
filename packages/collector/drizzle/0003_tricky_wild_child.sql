CREATE INDEX `idx_electorate_results_seat` ON `electorate_results` (`electorate`,`scrape_id`);--> statement-breakpoint
CREATE INDEX `idx_party_vote_results_seat` ON `party_vote_results` (`electorate`,`scrape_id`);--> statement-breakpoint
CREATE INDEX `idx_scrape_snapshots_year_started` ON `scrape_snapshots` (`election_year`,`started_at`);