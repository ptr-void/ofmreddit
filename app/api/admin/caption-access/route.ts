import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query, queryOne } from "@/lib/db"
import { readCaptionAccess } from "@/lib/caption-access"

export const dynamic = "force-dynamic"
async function isAdmin(request: Request) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1]
  const payload = token ? verifyToken(token) : null
  if (!payload || !Number.isSafeInteger(payload.userId) || payload.userId <= 0) return false
  const user = await queryOne<{ is_admin: number }>("SELECT is_admin FROM users WHERE id = ? LIMIT 1", [payload.userId])
  return Number(user?.is_admin) === 1
}

export async function GET(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    return NextResponse.json(await readCaptionAccess(), { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    return NextResponse.json({ error: "Failed to load caption access." }, { status: 503 })
  }
}

export async function PUT(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const body = await request.json().catch(() => null)
    if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 })
    if (!(await readCaptionAccess()).configured) {
      return NextResponse.json({ error: "Apply the caption-access migration before using this control." }, { status: 503 })
    }
    await query(`INSERT INTO site_controls (id, caption_generation_enabled) VALUES (1, ?)
      ON DUPLICATE KEY UPDATE caption_generation_enabled = VALUES(caption_generation_enabled)`, [body.enabled ? 1 : 0])
    return NextResponse.json(await readCaptionAccess(), { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    return NextResponse.json({ error: "Failed to save caption access." }, { status: 503 })
  }
}
