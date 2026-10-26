-- The margin-of-error machinery is gone: a count is not a sample, so a
-- sampling ratio never described it. `predictionStatus` went with it, and the
-- two columns that stored its coarse read-out (`is_predicted`,
-- `predicted_winner`) had no reader left: the dashboard draws a seat's chance
-- of winning from the p(win) model (`seatChanceFor` in
-- `packages/core/src/notional-baseline.ts`) and the feed carries that chance
-- itself, never a status word. `/history/*` stopped selecting all three in the
-- same change.
ALTER TABLE `electorate_results` DROP COLUMN `is_predicted`;--> statement-breakpoint
ALTER TABLE `electorate_summary` DROP COLUMN `predicted_winner`;--> statement-breakpoint
ALTER TABLE `electorate_summary` DROP COLUMN `margin_of_error`;