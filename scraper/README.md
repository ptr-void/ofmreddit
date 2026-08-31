# Consolidated Subreddit Sync

## Confirmed legacy lineage

- `fred - sheet 1.py` is the newest Fred file by modification time (March 1, 2026, 08:25) and updates Sheet1 `Total Members`.
- `fred - sheet 3.py` is the advanced analyzer that created the seven current Sheet3 columns. `fred - sheet 3 errors.py` is its newer March 1 retry utility, not a different analytics model.
- `scraper/subreddit_sync.py` replaces those three execution paths with one resumable command.

## What the v2 command collects

- Members/subscribers
- BTV and TSDI
- Upvote/comment ratio (`total comments` by default; pass `--exact-root-comments` for the slower legacy basis)
- Observed minimum post, comment, and combined karma plus account age
- BotBouncer/SafestBot moderator detection, including names such as `bot-bouncer`
- Restricted/private verification signal
- Weekly top 10 post details and the 1 / 2-5 / 6-10 upvote summaries
- CTA title evidence for `?`, `do`, `or`, `would`, `how`, and `what` after a one-hour survival window

The minimum karma and age fields are **observed successful-poster minima**, not a direct read of hidden AutoModerator rules.

## Safety and recovery behavior

- No Google Sheet or MySQL writes occur without `--write-sheets` or `--write-db`.
- Sheet3 is matched by normalized subreddit name. Duplicate Sheet3 rows receive the same update; a different subreddit is never overwritten because its row number changed.
- Sheet1 writes are batched and limited to column D (`Total Members`) and column F (`Bot Bouncer Present`). Existing Verification and Niche values are preserved.
- Failed scrapes update only status/error metadata; last successful analytics remain intact.
- Individual unavailable/private subreddit errors are recorded without failing the whole batch, so successful rows remain committed. Use `--fail-on-row-error` when strict batch failure is required.
- Sheet3 `Sync Status` + `Scraped At UTC` records every attempted row. Invisible spreadsheet developer metadata stores the active cycle boundary and 24-hour rest deadline without adding control cells or another visible sheet.
- MySQL uses one transaction and defaults to `update-only`, which skips names not already present in `master_subreddits`.
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
python scraper\subreddit_sync.py --subreddit asianhotties --hot-limit 3 --new-limit 3
python scraper\migrate_schema.py
```

`migrate_schema.py` is read-only unless `--apply` is supplied.

### Controlled writes

```powershell
# Small Google Sheet canary; no DB write
python scraper\subreddit_sync.py --subreddit asianhotties --write-sheets --force

# Normal batch; existing DB rows only
python scraper\subreddit_sync.py --write-sheets --write-db --db-sync-mode update-only --max-subreddits 10
```

Reports and checkpoints are written to `output/` and ignored by Git.

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
