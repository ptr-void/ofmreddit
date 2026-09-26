import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { verifyAdminToken } from "@/lib/auth"

function admin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  return token ? verifyAdminToken(token) : null
}

export async function GET(req: Request) {
  if (!admin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  const rows = await query<any>(`
    SELECT
      id,
      name,
      price,
      duration_days,
      usage_period_days,
      weekly_scraper_limit,
      weekly_planner_limit,
      weekly_caption_limit,
      weekly_database_limit,
      saved_username_limit,     
      saved_profile_limit,
      daily_subreddit_checker_limit,
      is_active,
      updated_at,
      created_at
    FROM subscription_tiers
    ORDER BY id ASC
  `)
  return NextResponse.json({ tiers: rows })
}

export async function PUT(req: Request) {
  if (!admin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  const { tier } = await req.json()

  const id = Number(tier?.id)
  const name = String(tier?.name ?? "")
  const price =
    tier?.price === null || tier?.price === "" || Number.isNaN(Number(tier?.price))
      ? null
      : Number(tier.price)
  const duration_days = Math.max(1, Math.min(3650, Number(tier?.duration_days ?? 30)))
  const usage_period_days = Math.max(1, Math.min(365, Number(tier?.usage_period_days ?? 7)))

  const weekly_scraper_limit = Number(tier?.weekly_scraper_limit ?? 0)
  const weekly_database_limit = Number(tier?.weekly_database_limit ?? 0)
  const weekly_planner_limit = -1
  const weekly_caption_limit = -1
  const saved_username_limit = 3
  const saved_profile_limit = 0
  const daily_subreddit_checker_limit = Number(tier?.daily_subreddit_checker_limit ?? 0)

  if (!id) return NextResponse.json({ error: "Missing tier id" }, { status: 400 })

  await query(
    `
    UPDATE subscription_tiers
       SET name = ?,
          price = ?,                      
          duration_days = ?,
          usage_period_days = ?,
          weekly_scraper_limit = ?,
          weekly_planner_limit = ?,
          weekly_caption_limit = ?,
          weekly_database_limit = ?,
          saved_username_limit = ?,      
          saved_profile_limit = ?,
          daily_subreddit_checker_limit = ?,
          updated_at = NOW()
     WHERE id = ?
    `,
    [
      name,
      price,
      duration_days,
      usage_period_days,
      weekly_scraper_limit,
      weekly_planner_limit,
      weekly_caption_limit,
      weekly_database_limit,
      saved_username_limit,
      saved_profile_limit,
      daily_subreddit_checker_limit,
      id,
    ],
  )

  const updated = await query<any>(
    `SELECT id, name, price, duration_days, usage_period_days, weekly_scraper_limit, weekly_planner_limit, weekly_caption_limit, weekly_database_limit, saved_username_limit, saved_profile_limit, daily_subreddit_checker_limit, is_active, updated_at, created_at
       FROM subscription_tiers
      WHERE id = ?`,
    [id],
  )
  return NextResponse.json({ tier: updated[0] })
}

export async function PATCH(req: Request) {
  if (!admin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid tier id" }, { status: 400 })
  if (![true, false, 1, 0].includes(body?.is_active)) {
    return NextResponse.json({ error: "is_active must be a boolean" }, { status: 400 })
  }
  const is_active = body.is_active === true || body.is_active === 1

  const tier = await query<any>("SELECT id, name, price FROM subscription_tiers WHERE id = ? LIMIT 1", [id])
  if (!tier.length) return NextResponse.json({ error: "Tier not found" }, { status: 404 })
  if (!is_active && (String(tier[0].name).trim().toLowerCase() === "free" || tier[0].price == null || Number(tier[0].price) <= 0)) {
    return NextResponse.json({ error: "The Free tier must stay available" }, { status: 400 })
  }

  await query("UPDATE subscription_tiers SET is_active = ?, updated_at = NOW() WHERE id = ?", [is_active ? 1 : 0, id])
  return NextResponse.json({ id, is_active })
}
