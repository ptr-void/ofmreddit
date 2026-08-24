import { type NextRequest, NextResponse } from "next/server"
import { verifyAdminToken } from "@/lib/auth"
import { query } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "")
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = verifyAdminToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const users = await query(
      `SELECT 
        u.id, 
        u.email, 
        u.username,
        u.is_admin, 
        u.email_verified, 
        u.created_at,
        u.updated_at,
        u.custom_subreddit_checker_limit,
        (SELECT st.name FROM user_subscriptions us JOIN subscription_tiers st ON us.tier_id = st.id WHERE us.user_id = u.id AND st.is_active = 1 AND us.starts_at <= NOW() AND (us.ends_at IS NULL OR us.ends_at >= NOW()) ORDER BY st.price DESC LIMIT 1) as tier_name,
        (SELECT COUNT(*) FROM feature_usage WHERE user_id = u.id AND feature = 'scraper') as spa_uses,
        (SELECT COUNT(*) FROM feature_usage WHERE user_id = u.id AND feature = 'subreddit_checker') as checker_uses,
        (SELECT MAX(occurred_at) FROM feature_usage WHERE user_id = u.id) as last_active,
        b.id as banned_id,
        b.reason as ban_reason,
        b.banned_at
      FROM users u
      LEFT JOIN banned_users b ON u.id = b.user_id
      ORDER BY u.created_at DESC`,
    )

    return NextResponse.json({ users })
  } catch (error: any) {
    console.error("Error fetching users:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "")
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const payload = verifyAdminToken(token)
    if (!payload) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const { userId, username, limit } = await request.json()
    if (!userId) return NextResponse.json({ error: "User ID is required" }, { status: 400 })

    if (limit !== undefined) {
      await query("UPDATE users SET custom_subreddit_checker_limit = ? WHERE id = ?", [limit, userId])
      return NextResponse.json({ success: true, user: { id: Number(userId), custom_subreddit_checker_limit: limit } })
    }

    const cleanName =
      typeof username === "string" && username.trim() !== "" ? username.trim() : null

    await query("UPDATE users SET username = ? WHERE id = ?", [cleanName, userId])

    return NextResponse.json({
      success: true,
      user: { id: Number(userId), username: cleanName ?? null }
    })
  } catch (error: any) {
    console.error("Error updating user:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "")
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = verifyAdminToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("id")

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }


    if (Number.parseInt(userId) === payload.userId) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 })
    }

    await query("DELETE FROM users WHERE id = ?", [userId])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting user:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
