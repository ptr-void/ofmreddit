# OFMReddit

A full-stack Next.js application for Reddit analytics and AI-powered caption generation.

## Features

- **User Authentication**: Secure login and registration with JWT
- **Reddit Scraper**: Analyze Reddit user posts and generate performance reports
- **Caption Generator**: AI-powered caption generation using Hugging Face API
- **MySQL Database**: Store user data, posts, and captions
- **Scheduled Subreddit Sync**: Batched Google Sheets/MySQL analytics with GitHub Actions

See [`scraper/README.md`](scraper/README.md) for the consolidated Fred scraper,
dry-run workflow, production-safe DB migration plan, and scheduler secrets.

## Setup Instructions

### 1. Install Dependencies

\`\`\`bash
npm install
\`\`\`

### 2. Database Setup

Create a MySQL database and run the SQL script:

\`\`\`bash
mysql -u root -p < scripts/001-create-tables.sql
\`\`\`

Or manually create the database:

\`\`\`sql
CREATE DATABASE nibba;
USE nibba;
\`\`\`

Then run the SQL script from `scripts/001-create-tables.sql`.

### 3. Environment Variables

Copy `.env.example` to `.env` and update with your credentials:

\`\`\`bash
cp .env.example .env
\`\`\`

Update the following variables:
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - Your MySQL credentials
- `JWT_SECRET` - A secure random string for JWT signing
- `HUGGINGFACE_API_KEY` - Your Hugging Face API key
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `REDDIT_REFRESH_TOKEN` - Your Reddit API credentials

### 4. Run the Development Server

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

\`\`\`
├── app/
│   ├── api/
│   │   ├── auth/          # Authentication endpoints
│   │   ├── scrape/        # Reddit scraper API
│   │   └── caption-generator/  # Caption generation API
│   ├── login/             # Login page
│   ├── register/          # Registration page
│   ├── scraper/           # Reddit scraper page
│   └── caption-generator/ # Caption generator page
├── components/
│   ├── navigation.tsx     # Navigation bar
│   ├── scraper/           # Scraper components
│   └── caption-generator/ # Caption generator components
├── lib/
│   ├── db.ts             # Database connection
│   └── auth.ts           # Authentication utilities
└── scripts/
    └── 001-create-tables.sql  # Database schema
\`\`\`

## Technologies Used

- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **MySQL2** - Database driver
- **JWT** - Authentication
- **Hugging Face API** - AI caption generation
- **Reddit API** - Data scraping
- **ExcelJS** - Excel file generation
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Scraper
- `POST /api/scrape` - Scrape Reddit data
- `GET /api/scrape?sid={sessionId}&progress=1` - Get scraping progress
- `GET /api/scrape?id={fileId}` - Download Excel file
- `DELETE /api/scrape?sid={sessionId}` - Cancel scraping session

### Caption Generator
- `POST /api/caption-generator` - Generate captions

## License

MIT

## Caption generator model and Gem-style requests

The caption route defaults to `gemini-3.8-flash`. An optional
`CAPTION_GEMINI_MODEL` deployment variable overrides only this caption route.
The previous `GEMINI_MODEL` override is no longer used here, so an old 2.5 setting
cannot accidentally pin caption generation to the previous model.

The saved `caption_generator` admin prompt is sent unchanged as the system
instruction. Every attached knowledge document is included in every request;
DOCX files are extracted in full. XML output is parsed into the existing UI
caption cards after generation, without a competing JSON-only instruction.
JSON output remains readable for older prompt versions. The UI interactive flag
maps to the prompt's `clickbait_style` (`y`/`n`), and quick mode omits unused
advanced-form defaults. The route handles one post per request and validates
its ID and the caption count required by the prompt (five by default).

Gemini 3.8 defaults to `thinkingLevel: low` for caption latency; optional
`CAPTION_GEMINI_THINKING_LEVEL=medium` or `high` retains a higher reasoning setting.
Deprecated temperature and thinking-budget parameters are omitted. Transient HTTP
errors, per-attempt timeouts and interrupted connections have at most three retries
with exponential backoff and jitter, using the same model, instructions and files. Long provider cooldowns and generation timeouts
are shown as retryable errors; there is no silent downgrade to another model.

This recreates the supplied instructions and knowledge, not a call to a hosted
Gem in the Gemini app. Identical wording or subjective client approval is not
guaranteed. Compare matched inputs against client-approved Gem examples before
claiming output parity. Model access and unit tests alone do not prove caption
quality or live generation availability.

Migration reference: https://ai.google.dev/gemini-api/docs/generate-content/latest-model

### Four-week performance averages

Top 1, Top 2–5 and Top 6–10 display equal-weight averages of four UTC calendar
weeks, **not four scrape runs**. Each week contributes its latest positive raw
reading for that rank group. Current-week samples enter the displayed average
only from Wednesday 00:00 UTC; before that, the previous four completed weeks
remain selected. Each group handles missing readings independently. Missing or
zero refreshes retain the last published average rather than forcing it to zero.

The existing sync records raw readings in `Weekly Metrics History`; both the
worker and website use the same calendar-window rules. The paid database view
recomputes every performance cell from this history, not only missing cells.
Free previews do not read or expose it. Fewer than four recorded weeks use the
available eligible weeks while history builds; no extra weeks or scores are
fabricated. If no eligible reading exists, the last published sheet value stays.

The former `Weekly Metric Baselines` worksheet is preserved for audit only: it
is not read by the website or generated automatically by the sync. Historical
post-period estimates and per-cell date badges are removed. `—` remains for
metrics with neither recorded eligible history nor a published positive value.

### Account-linked website visits

The admin Website Visits table shows Telegram handles and email for visits made
with a verified signed-in token. Tracking resolves the user ID server-side and
joins the existing user account; guest visits and old rows remain unidentified.
It never backfills identity from IP addresses. These are page visits, not a count
of successful caption generations. Account details are returned only to admins.

For an existing database, prepare the additive identity column/index before deployment:

```powershell
node scripts/migrate-visit-identity.cjs # read-only plan
node scripts/migrate-visit-identity.cjs --apply # save schema backup, add nullable user_id + index, verify
```

Fresh visit tables include the column. The setup endpoint requires admin auth.
Until migration, tracking and admin analytics retain their legacy behavior and
the admin table displays a setup notice. No live request performs schema writes.
For rollback, revert application code while retaining the nullable column/index
so newly linked history is not lost. Do not drop it or reconstruct old visitors.

The Gemini project's API quota is managed separately in Google AI Studio. The
site does not impose a 20-generation per-user caption cap. Enabling a paid API
tier can increase the provider quota but changes billing; it is not enabled by
this visit-logging feature or by an application code update.

### Caption generator user-access switch

Admin **Site Controls → Caption Generator User Access** pauses caption generation
and caption image analysis for non-admin users. Admins remain able to test, and
those tests still consume the normal provider quota. Current database admin status
is checked server-side, not a browser role flag. Direct API calls and already-open
tabs are covered; no knowledge downloads or provider calls start for blocked users.
Requests already admitted before a pause may finish. This is not a quota increase.

Prepare the additive default-on column before using the control:

```powershell
node scripts/migrate-caption-access.cjs # read-only plan
node scripts/migrate-caption-access.cjs --apply # schema backup + additive column + readback
```

Before migration, existing user access is preserved and the admin switch is disabled
with a setup notice. Settings are persisted in `site_controls`, independently of
subscription controls. Caption pages recheck on focus and every 30 seconds, while
each generation/image-analysis request checks immediately. Inputs are retained
while paused. For rollback, turn access on first and revert the application code;
retain the additive column. Older app versions do not enforce this switch.

### Caption timeout handling

Caption failures distinguish provider `CONTENT_BLOCKED` feedback (HTTP 422),
incomplete generations and invalid caption output from retryable transport/quota
errors. Prompt feedback and candidate safety metadata are checked before parsing
or showing generated text. Blocked/partial text is never returned to the UI;
content blocks are not retried, and inputs stay unchanged. Provider safety
settings are unchanged. The website shows one accessible error alert rather than
duplicating it inside the form. API generation is not a guarantee of identical
Gem responses, even with the same saved prompt and knowledge files.

Caption generation retains the configured model, admin prompt and all documents.
The route allows 180 seconds on Vercel, including a bounded 120-second
generation/retry window. Each attempt (including reading its response body) has a
45-second deadline, so one stalled call does not exhaust every retry. Cooldowns
from both `Retry-After` and Google `RetryInfo.retryDelay` are respected and passed
to the UI; no automatic browser retries or
silent model switches occur. A successful live test is a point-in-time check,
not a guarantee against later provider overload.

Daily request quota exhaustion is returned as `DAILY_QUOTA_EXHAUSTED`, with the
provider's actual limit and reported retry timestamp when supplied. It is not
retried as an overload or shown as a ten-second outage. Quotas belong to the API
project/model, not the Gemini app subscription. A higher-quota billing tier/key
must be configured separately; this code never changes billing or rotates keys.

### Live caption website smoke test

Run `node scripts/test-caption-website.cjs` with `CAPTION_WEBSITE_URL` set to the
canonical site origin and `CAPTION_TEST_TOKEN` set to a test account's login token.
This is opt-in and incurs real Gemini usage. It opens the actual form, enters
neutral fitness context at level 1, clicks Generate three times (including the
interactive mode), and verifies that all five returned captions appear in cards.
It checks the model, all three knowledge documents, retained inputs and low
thinking metadata. Reports/screenshots are saved under ignored `output/`; tokens
and caption text are not included in the JSON report. API mocks alone do not
count as passing this browser test.
