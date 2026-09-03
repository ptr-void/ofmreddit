# Consolidated Subreddit Sync

## Confirmed legacy lineage

- `fred - sheet 1.py` is the newest Fred file by modification time (March 1, 2026, 08:25) and updates Sheet1 `Total Members`.
- `fred - sheet 3.py` is the legacy advanced analyzer. Its unused BTV, TSDI, and upvote/comment fields have been retired; the maintained sync writes only fields used by the website plus recovery checkpoints.
- `scraper/subreddit_sync.py` replaces those three execution paths with one resumable command.

## What the v2 command collects

- Members/subscribers
- Observed minimum post, comment, and combined karma plus account age
- BotBouncer moderator detection, including names such as `bot-bouncer`
- Creator verification requirement detection from subreddit rules and descriptions
- Weekly top 10 post details and the 1 / 2-5 / 6-10 upvote summaries
- CTA title evidence for `?`, `do`, `or`, `would`, `how`, and `what` after a one-hour survival window

The minimum karma and age fields are **observed successful-poster minima**, not a direct read of hidden AutoModerator rules.
The website labels them **Observed Minimums**; a high sampled value is not a verified posting threshold.
Subscriber totals are distinct from Reddit's weekly visitor metric.

## Safety and recovery behavior

- No Google Sheet or MySQL writes occur without `--write-sheets` or `--write-db`.
- Sheet1 is the only table. Base fields, consolidated niche tags, website-facing analytics, and recovery checkpoints are matched by normalized subreddit name and batch-written by header.
- Existing Subreddit, Link, and Niche values are preserved during scraper updates. The scraper never creates a Sheet row for an ad-hoc or missing subreddit.
- `Scraped At UTC`, `Sync Status`, and `Sync Error` remain hidden columns in Sheet1 so recovery does not require another visible tab.
- Failed scrapes update only status/error metadata; last successful analytics remain intact.
- The website flags failed-refresh rows as **Stale**, rather than presenting retained values as newly verified data. A failed request is not proof that a subreddit is permanently dead.
- The writer reloads the table immediately before resolving destination rows by name, so rows moved/deleted during a long scrape are not written using selection-time positions. Avoid editing/sorting the source during the brief write itself; Sheets values writes are not conditional transactions.
- Missing Reddit subscriber counts are kept unknown rather than replaced with zero. Numeric sheet columns use comma-separated number formats.
- Individual unavailable/private subreddit errors are recorded without failing the whole batch, so successful rows remain committed. Use `--fail-on-row-error` when strict batch failure is required.
- Invisible spreadsheet developer metadata stores the active cycle boundary and 24-hour rest deadline without adding control cells or another visible sheet.
- MySQL uses one transaction and defaults to `update-only`, which skips names not already present in `master_subreddits`.
- A temporary MySQL connectivity failure is recorded in the run report after Sheet1 commits, but it no longer discards progress or breaks the complete-pass chain. Use `--fail-on-db-error` only when a strict DB mirror is required.
- New DB rows require `--db-sync-mode upsert` and default to `pending`.
- Schema DDL is separate and is never run by the scraper.

## Local setup

```powershell
cd "C:\Users\Jay Yan Tiongzon\Documents\React\Projects\Client\ofmreddit"
python -m pip install -r scraper\requirements.txt
Copy-Item scraper\.env.example .env.local # only for a new local environment
```

Use environment variables rather than JSON/private keys embedded in Python. The optional `REDDIT_REFRESH_TOKEN` is needed for current moderator-list access.
The Google Sheets API must be enabled in the service account's Google Cloud project, and the target spreadsheet must be shared with that service account email.

### Tests and read-only checks

```powershell
python -m unittest discover -s scraper\tests -v
python scraper\subreddit_sync.py --plan-only --max-subreddits 10
python scraper\subreddit_sync.py --subreddit asianhotties --new-limit 3
python scraper\migrate_schema.py
node --test tests/reddit-database-display.test.cjs
```

`migrate_schema.py` is read-only unless `--apply` is supplied.

### Targeted member-count audit and repair

`audit_member_counts.py --subreddit NAME` compares explicitly selected rows with Reddit's subscriber counter without changing the table. Repeat `--subreddit` to audit more names. Adding `--apply` saves a full value backup in `output/`, rechecks row identity and concurrent edits, writes only verified Total Members cells, and reads them back. It does not change MySQL, other analytics, rows, or cycle checkpoints. Failed/404 results are retained without inventing a count or deleting a row.

Restore an affected member cell from the backup only after checking that its current value is still the repair value; do not restore an entire table over newer scraper/user edits. Automatic deletion and automatic discovery are not enabled by this maintenance tool.

### Controlled writes

```powershell
# Small Google Sheet canary; no DB write
python scraper\subreddit_sync.py --subreddit asianhotties --write-sheets --force

# Normal batch; existing DB rows only
python scraper\subreddit_sync.py --write-sheets --write-db --db-sync-mode update-only --max-subreddits 10
```

Reports and checkpoints are written to `output/` and ignored by Git.

### One-table Google Sheet migration

`migrate_single_sheet.py` combines existing Sheet1 base values, Sheet2 niche tags, and the latest matching Sheet3 analytics into Sheet1. It writes a timestamped JSON backup and validates the full table before deleting the extra tabs.

```powershell
python scraper\migrate_single_sheet.py
python scraper\migrate_single_sheet.py --apply --delete-extra-sheets
```

## GitHub Actions complete-pass cycle

`.github/workflows/scraper-cron.yml` processes 20 ascending Sheet1 rows per batch. Each completed batch directly queues the next batch, so an active pass does not depend on GitHub's delayed cron delivery. A row counts as attempted for the pass whether Reddit returns data or a recorded error; this prevents unavailable subreddits from blocking later rows.

When every unique Sheet1 subreddit has been attempted, the scraper stores the completion time in invisible spreadsheet metadata, stops the chain, and rests for 24 hours. An hourly off-peak watchdog checks that deadline. The first watchdog delivered after the deadline starts a new complete pass, and the self-continuing chain resumes. The watchdog may start later than the exact deadline if GitHub delays a scheduled event, but it never starts early.

Add these repository secrets:

- `SYNC_ENABLED` — leave unset during review, then set exactly to `true`
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `REDDIT_REFRESH_TOKEN`
- `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

The scheduled write step remains gated until `SYNC_ENABLED=true`. The workflow uses `update-only`, has a single-run concurrency lock plus duplicate-run suppression, runs tests first, and uploads reports for 14 days.

Scheduled workflows run from the default branch, so merge/push the reviewed branch before expecting the cron trigger. GitHub may delay schedules under load; public repositories and private-plan quotas have different included Actions usage.

## Production database migration

1. Take a production backup/snapshot.
2. Run `python scraper/migrate_schema.py` to print the missing-column plan (read-only).
3. Review the output against `scraper/sql/001_scraper_v2_columns.sql`.
4. Run `python scraper/migrate_schema.py --apply` during a maintenance window.
5. Run a one-subreddit dry run, then a one-subreddit update-only canary.

The destructive down reference is `scraper/sql/rollback_001_scraper_v2_columns.sql`. Prefer restoring the backup if rollback is required.

A read-only table snapshot with SHA-256 verification is available with:

```powershell
python scraper\backup_master_subreddits.py
```

## Credential remediation

Legacy Fred files contained a Google service-account private key in source. Other legacy files also contain hard-coded tokens. Remove them from source, rotate/revoke the exposed credentials in their provider consoles, and store replacements only in local/GitHub/Vercel secrets. Rotation is an external account action and is intentionally separate from this code change.

## Hosting choice

GitHub Actions is the implemented scheduler because this batch can take longer than a typical serverless request. Vercel Cron is suited to short HTTP-triggered functions and is not used to launch this long Python batch. The existing Next.js app continues to read Sheet/MySQL results.

## Availability cleanup and discovery review

`subreddit_maintenance.py` is an independent, bounded maintenance stage in the
existing GitHub workflow. It does not change the full-pass/24-hour-rest metadata.
Dry-run is the default; production explicitly passes `--apply`.

```powershell
python scraper/backup_master_subreddits.py
python scraper/migrate_maintenance.py
python scraper/migrate_maintenance.py --apply
python scraper/subreddit_maintenance.py --max-checks 20 --discovery-limit 5
python scraper/subreddit_maintenance.py --apply --max-checks 20 --discovery-limit 5
```

The migration only creates three maintenance bookkeeping tables; it does not
alter subscription, user, or existing subreddit tables.

### Restorable archival

* Only errored/previously archived rows receive availability probes. Healthy
  successful rows are not judged by low members or low activity.
* A public API canary must work. A candidate needs an explicit Reddit `banned`
  response, or a 404 plus an independent exact-name lookup with no match.
* Three observations, each at least 24 hours apart and spanning at least 48
  hours, are required. 403/private, 429, 5xx, timeouts, and uncertain responses
  never qualify and reset an unarchived candidate's evidence streak.
* At most five communities are archived per run. First-run evidence is not
  backdated from historical errors. No immediate bulk deletion occurs.
* A full row snapshot is saved to MySQL before archival. Original Sheet values
  stay in the same table, with the row hidden and internal status `archived`.
  The website excludes archives from both Sheets and the approved DB mirror.
  The normal scraper neither selects nor overwrites archived rows.
* **Admin > Subreddit Review > Restore** queues restoration. A subsequent
  maintenance run unhides the row and clears its scraper checkpoint. A live
  response during the daily archived-row recheck also restores it. Restores
  receive a 72-hour grace period. Saved snapshots are retained.

### Discovery and admission

* Once per 24 hours, rotate through existing manually entered niche vocabulary.
  Search at most 25 results; queue at most five eligible new communities.
* Default eligibility: public, adult-designated, at least 100 subscribers and
  a surviving recent post within 30 days. Override with `DISCOVERY_MIN_MEMBERS`
  and `DISCOVERY_MAX_POST_AGE_DAYS`. These are candidate filters, NOT deletion
  criteria. Admin review determines suitability.
* Normalize/deduplicate against Sheets, every master row (including rejected),
  and the archive registry. Never replace curated niche tags or reset rejected
  and approved decisions. New niche values are blank until manually assigned.
* **Admin > Subreddit Review > Approve** queues an addition, rather than
  publishing immediately. The worker verifies live identity, appends by name,
  extends the existing styled table, verifies readback, then approves the DB
  row. Retrying after a partial write does not append a duplicate.
* Pending/rejected discoveries are excluded from the public database.
* Admin review endpoints require an admin JWT. Queue decisions share a MySQL
  named lock with the worker to avoid approve/reject races. Maintenance errors
  produce a workflow warning/report, not an interruption of the main pass chain.

### Audits and rollback

```powershell
python scraper/audit_member_counts.py --all
python scraper/audit_member_counts.py --all --apply
python scraper/audit_table.py
```

Member repair writes only counts backed by matching Reddit metadata. It saves
an entire values snapshot first, rematches names immediately before writing,
checks for changed source counts, updates duplicates consistently, and verifies
readback. Unavailable results never become zero. The structural audit is
read-only: it identifies duplicates, mismatched links, nonnumeric cells, stale
values, and unusually high **observed** karma samples. A high sample is not
proof of an actual subreddit posting requirement.

Reports/snapshots are under ignored `output/` and workflow artifacts. Do not
restore entire old grids over newer manual edits; use the normalized name and
specific backed-up cell. To roll back availability behavior, queue and process
restores for archived rows before reverting the feature. Stop maintenance by
removing only its workflow stage; retain archive snapshots and the public
archive filter until any needed restores finish. No destructive table drop or
production row deletion is part of this feature.
