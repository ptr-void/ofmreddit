import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query, queryOne } from "@/lib/db"

async function requireAdmin(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m?.[1]) return null
  const me = verifyToken(m[1])
  const userId = (me as any)?.userId ?? (me as any)?.id
  if (!userId) return null
  const row = await queryOne<{ is_admin: number }>("SELECT is_admin FROM users WHERE id = ?", [userId])
  if (!row || row.is_admin !== 1) return null
  return userId
}

async function syncUserSubscriptionDefaultCooldown() {
  const site = await queryOne<{ default_cooldown: string }>(
    "SELECT default_cooldown FROM site_controls WHERE id = 1 LIMIT 1",
    []
  )
  if (site?.default_cooldown) {
    const defaultCooldown = site.default_cooldown || "0"
    await query(
      `ALTER TABLE user_subscriptions 
       ALTER cooldown SET DEFAULT '${defaultCooldown}'`,
      []
    )
  }
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  let row = await queryOne<{ show_sub: number; default_cooldown: string; subreddit_checker_limit: number }>(
    "SELECT show_sub, default_cooldown, subreddit_checker_limit FROM site_controls WHERE id = 1 LIMIT 1",
    [],
  )
  if (!row) {
    await query("INSERT INTO site_controls (id, show_sub, default_cooldown, subreddit_checker_limit) VALUES (1, 1, '30', 5)", [])
    row = await queryOne<{ show_sub: number; default_cooldown: string; subreddit_checker_limit: number }>(
      "SELECT show_sub, default_cooldown, subreddit_checker_limit FROM site_controls WHERE id = 1 LIMIT 1",
      [],
    )
  }
  return NextResponse.json({ 
    show_sub: row?.show_sub ?? 1, 
    default_cooldown: (row?.default_cooldown as "0" | "10" | "30") ?? "30",
    subreddit_checker_limit: row?.subreddit_checker_limit ?? 5
  })
}

export async function PUT(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await req.json()
  const fields: string[] = []
  const values: any[] = []
  if (typeof body.show_sub === "number") {
    fields.push("show_sub = ?")
    values.push(body.show_sub)
  }
  if (typeof body.default_cooldown === "string") {
    fields.push("default_cooldown = ?")
    values.push(body.default_cooldown)
  }
  if (typeof body.subreddit_checker_limit === "number") {
    fields.push("subreddit_checker_limit = ?")
    values.push(body.subreddit_checker_limit)
  }
  if (fields.length === 0) return NextResponse.json({ error: "No changes" }, { status: 400 })
  values.push(1)
  await query(`UPDATE site_controls SET ${fields.join(", ")} WHERE id = ?`, values)
  await syncUserSubscriptionDefaultCooldown()
  const row = await queryOne<{ show_sub: number; default_cooldown: string; subreddit_checker_limit: number }>(
    "SELECT show_sub, default_cooldown, subreddit_checker_limit FROM site_controls WHERE id = 1 LIMIT 1",
    [],
  )
  return NextResponse.json({ 
    show_sub: row?.show_sub ?? 1, 
    default_cooldown: (row?.default_cooldown as "0" | "10" | "30") ?? "30",
    subreddit_checker_limit: row?.subreddit_checker_limit ?? 5
  })
}
