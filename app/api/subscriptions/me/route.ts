import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { queryOne } from "@/lib/db"

export async function GET(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  const user = token ? verifyToken(token) : null
  if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const subscription = await queryOne(
    `SELECT us.id, us.tier_id, st.name AS tier_name, us.starts_at, us.ends_at
       FROM user_subscriptions us
       JOIN subscription_tiers st ON st.id=us.tier_id AND st.is_active=1
      WHERE us.user_id=? AND us.starts_at <= NOW()
        AND (us.ends_at IS NULL OR us.ends_at >= NOW())
      ORDER BY us.starts_at DESC LIMIT 1`,
    [user.userId],
  )
  if (subscription) return NextResponse.json({ subscription })
  const free = await queryOne(
    `SELECT NULL AS id, id AS tier_id, name AS tier_name, NULL AS starts_at, NULL AS ends_at
       FROM subscription_tiers WHERE is_active=1 AND LOWER(name)='free' ORDER BY id LIMIT 1`,
  )
  return NextResponse.json({ subscription: free })
}
