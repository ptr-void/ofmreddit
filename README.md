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

Gemini 3.8 uses `thinkingLevel: medium`; deprecated temperature and thinking-budget
parameters are omitted. Explicit transient HTTP errors have at most three retries
with exponential backoff and jitter, using the same model and payload. Long provider cooldowns and generation timeouts
are shown as retryable errors; there is no silent downgrade to another model.

This recreates the supplied instructions and knowledge, not a call to a hosted
Gem in the Gemini app. Identical wording or subjective client approval is not
guaranteed. Compare matched inputs against client-approved Gem examples before
claiming output parity. Model access and unit tests alone do not prove caption
quality or live generation availability.

Migration reference: https://ai.google.dev/gemini-api/docs/generate-content/latest-model

### Weekly history display fallback

Paid database views recover blank/zero weekly metrics from `Weekly Metrics History`
using the scraper's latest-three-positive mean, without changing published nonzero
values or writing to Sheets. Only the five history columns are fetched, and only
when weekly values are missing. Missing/invalid history does not prevent the main
sheet from loading. A dash means no positive history exists, not that rolling
averages are pending. Free previews never fetch or expose history.

### Dated historical weekly baselines

When a stat has neither a published weekly average nor positive weekly history,
the database can show a **Historical** seven-day baseline with its date range.
The score is measured at the recorded observation time for older posts; it is not
current weekly activity or an archived score from that historical date. Sparse
rank groups may use different older periods, each labelled individually.

The scraper stores these separately in `Weekly Metric Baselines`, not in the
live sheet's weekly cells or `Weekly Metrics History`. Valid current averages
always take precedence. The regular sync backfills missing baselines once and
retains them; users do not have to run it manually. It examines at most 1,000
recent posts per affected subreddit and publishes only complete seven-day
periods. A group with no complete positive period stays unavailable, never made
up or copied from a different rank group.

For an initial audit/backfill:

```powershell
python scraper/weekly_baselines.py --max-subreddits 30
# Review the generated report, then apply it without fetching Reddit again:
python scraper/weekly_baselines.py --apply --apply-report output/weekly-baseline-backfill-TIMESTAMP.json
```

Application rechecks active membership, missing cells and existing baseline keys,
saves the pre-write worksheet snapshot plus exact appended records, and verifies
readback. Rollback is limited to those appended records in the baseline worksheet
using the saved snapshot; do not replace the live sheet or newer weekly history.

Caption generation retains the configured model, admin prompt and all documents.
The route allows 90 seconds on Vercel, including a 60-second generation/retry
window. Provider cooldowns are passed to the UI; no automatic browser retries or
silent model switches occur. A successful live test is a point-in-time check,
not a guarantee against later provider overload.
