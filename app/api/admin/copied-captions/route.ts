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

    const { searchParams } = new URL(request.url)
    const limit = searchParams.get("limit") || "100"

    const limitInt = Number.parseInt(limit) || 100
    const copiedCaptions = await query(
      `SELECT 
        cc.id,
        cc.caption_text,
        cc.copied_at,
        u.email as user_email,
        p.name as post_name
      FROM copied_captions cc
      JOIN users u ON cc.user_id = u.id
      JOIN posts p ON cc.post_id = p.id
      ORDER BY cc.copied_at DESC
      LIMIT ${limitInt}`,
      [],
    )

    return NextResponse.json({ copiedCaptions })
  } catch (error: any) {
    console.error("Error fetching copied captions:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
