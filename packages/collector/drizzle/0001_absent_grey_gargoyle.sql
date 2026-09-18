ALTER TABLE `scrape_snapshots` ADD `election_year` text;--> statement-breakpoint
-- Rows written before election cycles were tracked all came from the 2023
-- feed (or the 2023-shaped mock), so attribute them to that cycle instead of
-- leaving them NULL. Any NULL that survives is excluded from year-scoped
-- history queries, which is the safe default.
UPDATE `scrape_snapshots` SET `election_year` = '2023' WHERE `election_year` IS NULL;
