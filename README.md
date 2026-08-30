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
