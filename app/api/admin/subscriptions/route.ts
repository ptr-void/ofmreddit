import { NextResponse } from "next/server"
import { query, queryOne } from "@/lib/db"
import { verifyAdminToken } from "@/lib/auth"

function admin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  return token ? verifyAdminToken(token) : null
}

export async function GET(req: Request) {
  if (!admin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  const subscriptions = await query(
    `SELECT 
      us.id,
      us.user_id,
      us.tier_id,
      st.name AS tier_name,
      us.starts_at,
      us.ends_at,
      us.cooldown,
      u.email AS user_email
     FROM user_subscriptions us
     JOIN users u ON us.user_id = u.id
     JOIN subscription_tiers st ON us.tier_id = st.id
     ORDER BY us.id ASC`
  )
  return NextResponse.json({ subscriptions })
}

export async function PUT(req: Request) {
  if (!admin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  const { userId, tierId } = await req.json()
  if (!Number.isSafeInteger(Number(userId)) || !Number.isSafeInteger(Number(tierId))) {
    return NextResponse.json({ error: "Select a valid user and tier" }, { status: 400 })
  }

  const tier = await queryOne<{ id: number }>("SELECT id FROM subscription_tiers WHERE id = ? AND is_active = 1", [tierId])
  if (!tier) return NextResponse.json({ error: "Tier not found" }, { status: 404 })

  const existing = await queryOne(
    `SELECT id 
     FROM user_subscriptions 
     WHERE user_id = ? 
     ORDER BY starts_at DESC 
     LIMIT 1`,
    [userId]
  )

  if (existing) {
    await query(
      `UPDATE user_subscriptions
       SET tier_id = ?, starts_at = NOW(), ends_at = NULL
       WHERE id = ?`,
      [tierId, existing.id]
    )
  } else {
    await query(
      `INSERT INTO user_subscriptions (user_id, tier_id, starts_at, ends_at)
       VALUES (?, ?, NOW(), NULL)`,
      [userId, tierId]
    )
  }

  const updated = await queryOne(
    `SELECT 
      us.id,
      us.user_id,
      us.tier_id,
      st.name AS tier_name,
      us.starts_at,
      us.ends_at,
      us.cooldown,
      u.email AS user_email
     FROM user_subscriptions us
     JOIN users u ON us.user_id = u.id
     JOIN subscription_tiers st ON us.tier_id = st.id
     WHERE us.user_id = ?
     ORDER BY us.starts_at DESC
     LIMIT 1`,
    [userId]
  )

  return NextResponse.json({ subscription: updated })
}
