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
  const { userId, tierId, starts_at, ends_at, cooldown } = await req.json()
  if (!userId || !tierId || !starts_at) {
    return NextResponse.json({ error: "Missing userId, tierId, or start date" }, { status: 400 })
  }

  await new Promise((r) => setTimeout(r, 900))

  const existing = await queryOne(
    `SELECT id 
     FROM user_subscriptions 
     WHERE user_id = ? 
     ORDER BY starts_at DESC 
     LIMIT 1`,
    [userId]
  )

  const cd = cooldown ?? "0"

  if (existing) {
    await query(
      `UPDATE user_subscriptions
       SET tier_id = ?, starts_at = ?, ends_at = ?, cooldown = ?
       WHERE id = ?`,
      [tierId, starts_at, ends_at ?? null, cd, existing.id]
    )
  } else {
    await query(
      `INSERT INTO user_subscriptions (user_id, tier_id, starts_at, ends_at, cooldown)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, tierId, starts_at, ends_at ?? null, cd]
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
