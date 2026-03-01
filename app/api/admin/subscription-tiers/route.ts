import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function GET() {
  const rows = await query<any>(`
    SELECT
      id,
      name,
      price,                   
      weekly_scraper_limit,
      weekly_planner_limit,
      weekly_caption_limit,
      weekly_database_limit,
      saved_username_limit,     
      saved_profile_limit,
      is_active,
      updated_at,
      created_at
    FROM subscription_tiers
    ORDER BY id ASC
  `)
  return NextResponse.json({ tiers: rows })
}

export async function PUT(req: Request) {
  const { tier } = await req.json()

  const id = Number(tier?.id)
  const name = String(tier?.name ?? "")
  const price =
    tier?.price === null || tier?.price === "" || Number.isNaN(Number(tier?.price))
      ? null
      : Number(tier.price)

  const weekly_scraper_limit = Number(tier?.weekly_scraper_limit ?? 0)
  const weekly_planner_limit = Number(tier?.weekly_planner_limit ?? 0)
  const weekly_caption_limit = Number(tier?.weekly_caption_limit ?? 0)
  const weekly_database_limit = Number(tier?.weekly_database_limit ?? 0)
  const saved_username_limit = Number(tier?.saved_username_limit ?? 0)
  const saved_profile_limit = Number(tier?.saved_profile_limit ?? 0)

  if (!id) return NextResponse.json({ error: "Missing tier id" }, { status: 400 })

  await query(
    `
    UPDATE subscription_tiers
       SET name = ?,
          price = ?,                      
          weekly_scraper_limit = ?,
          weekly_planner_limit = ?,
          weekly_caption_limit = ?,
          weekly_database_limit = ?,
          saved_username_limit = ?,      
          saved_profile_limit = ?,
          updated_at = NOW()
     WHERE id = ?
    `,
    [
      name,
      price,
      weekly_scraper_limit,
      weekly_planner_limit,
      weekly_caption_limit,
      weekly_database_limit,
      saved_username_limit,
      saved_profile_limit,
      id,
    ],
  )

  const updated = await query<any>(
    `SELECT id, name, price, weekly_scraper_limit, weekly_planner_limit, weekly_caption_limit, weekly_database_limit, saved_username_limit, saved_profile_limit, is_active, updated_at, created_at
       FROM subscription_tiers
      WHERE id = ?`,
    [id],
  )
  return NextResponse.json({ tier: updated[0] })
}
