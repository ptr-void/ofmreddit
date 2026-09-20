import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function GET() {
  const tiers = await query(
    `SELECT id, name, price, duration_days, usage_period_days, weekly_scraper_limit,
            weekly_database_limit, daily_subreddit_checker_limit
       FROM subscription_tiers WHERE is_active=1 ORDER BY id ASC`,
  )
  return NextResponse.json({ tiers }, { headers: { "Cache-Control": "no-store" } })
}
