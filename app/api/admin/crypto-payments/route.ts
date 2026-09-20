import { NextResponse } from "next/server"
import { verifyAdminToken } from "@/lib/auth"
import { query } from "@/lib/db"

export async function GET(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (!token || !verifyAdminToken(token)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  }
  await query(
    "UPDATE crypto_payment_intents SET status='expired', updated_at=NOW() WHERE status IN ('pending','confirming') AND expires_at <= NOW()",
  )
  const payments = await query(
    `SELECT p.id, p.expected_amount, p.coin, p.network, p.status,
            p.tx_id, p.created_at, p.expires_at, p.paid_at,
            t.name AS tier_name, p.duration_days,
            u.email, u.username, u.telegram_username
       FROM crypto_payment_intents p
       JOIN users u ON u.id = p.user_id
       JOIN subscription_tiers t ON t.id = p.tier_id
      ORDER BY p.created_at DESC
      LIMIT 250`,
  )
  return NextResponse.json({ payments })
}
