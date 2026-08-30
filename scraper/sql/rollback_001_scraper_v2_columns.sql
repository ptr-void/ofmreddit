-- Destructive rollback: export/backup these columns before running.
DROP INDEX idx_master_subreddits_last_scraped_at ON master_subreddits;
ALTER TABLE master_subreddits
  DROP COLUMN hot_1_weekly,
  DROP COLUMN hot_2_5_weekly_avg,
  DROP COLUMN hot_6_10_weekly_avg,
  DROP COLUMN has_bot_bouncer,
  DROP COLUMN requires_verification,
  DROP COLUMN allows_cta_captions,
  DROP COLUMN observed_accounts,
  DROP COLUMN cta_match_count,
  DROP COLUMN cta_sample_size,
  DROP COLUMN weekly_top_10_json,
  DROP COLUMN last_scraped_at,
  DROP COLUMN last_scrape_status,
  DROP COLUMN last_scrape_error;
