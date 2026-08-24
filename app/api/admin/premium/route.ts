import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { email, action } = await req.json()
    
    const users = await query<any>("SELECT id FROM users WHERE email = ?", [email])
    if (!users || users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    
    const userId = users[0].id
    
    if (action === "grant") {
      await query(
        `INSERT INTO user_subscriptions (user_id, tier_id, ends_at) 
         VALUES (?, 2, DATE_ADD(NOW(), INTERVAL 365 DAY))
         ON DUPLICATE KEY UPDATE tier_id = 2, ends_at = DATE_ADD(NOW(), INTERVAL 365 DAY)`,
        [userId]
      )
    } else if (action === "revoke") {
      await query("DELETE FROM user_subscriptions WHERE user_id = ?", [userId])
    }
    
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
