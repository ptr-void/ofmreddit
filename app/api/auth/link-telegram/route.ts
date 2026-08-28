import { type NextRequest, NextResponse } from "next/server"
import { verifyToken, signToken } from "@/lib/auth"
import { query, queryOne } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "")
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const { inviteCode } = await request.json()
    if (!inviteCode) {
      return NextResponse.json({ error: "Invite code is required" }, { status: 400 })
    }

    // Check if code exists
    const existingCode = await queryOne<{ code: string, user_name: string }>(
      "SELECT code, user_name FROM invite_codes WHERE code = ?",
      [inviteCode.toUpperCase()]
    )

    if (!existingCode) {
      return NextResponse.json(
        { error: "Invalid or already used Telegram invite code" },
        { status: 400 }
      )
    }

    const telegramUsername = existingCode.user_name

    // Update user
    await query(
      "UPDATE users SET telegram_username = ? WHERE id = ?",
      [telegramUsername, payload.userId]
    )

    // Remove used code
    await query("DELETE FROM invite_codes WHERE code = ?", [inviteCode.toUpperCase()])

    // Create new token
    const newTokenPayload = {
      ...payload,
      hasTelegramLinked: true,
    }
    const newToken = signToken(newTokenPayload)

    return NextResponse.json({
      success: true,
      token: newToken,
      hasTelegramLinked: true
    })
  } catch (error: any) {
    console.error("Link telegram error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
