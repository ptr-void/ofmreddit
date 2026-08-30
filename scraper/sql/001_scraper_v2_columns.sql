-- New-install reference. For an existing/partial production schema, use the
-- read-only planner first: python scraper/migrate_schema.py
ALTER TABLE master_subreddits
  ADD COLUMN hot_1_weekly INT DEFAULT 0,
  ADD COLUMN hot_2_5_weekly_avg INT DEFAULT 0,
  ADD COLUMN hot_6_10_weekly_avg INT DEFAULT 0,
  ADD COLUMN has_bot_bouncer BOOLEAN NULL,
  ADD COLUMN requires_verification BOOLEAN NULL,
  ADD COLUMN allows_cta_captions BOOLEAN NULL,
  ADD COLUMN observed_accounts INT DEFAULT 0,
  ADD COLUMN cta_match_count INT DEFAULT 0,
  ADD COLUMN cta_sample_size INT DEFAULT 0,
  ADD COLUMN weekly_top_10_json LONGTEXT NULL,
  ADD COLUMN last_scraped_at DATETIME NULL,
  ADD COLUMN last_scrape_status VARCHAR(32) NULL,
  ADD COLUMN last_scrape_error VARCHAR(500) NULL;

CREATE INDEX idx_master_subreddits_last_scraped_at
  ON master_subreddits (last_scraped_at);
