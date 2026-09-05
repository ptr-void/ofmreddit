import { NextResponse } from "next/server"
import { getPool, query } from "@/lib/db"
import { verifyAdminToken } from "@/lib/auth"

function admin(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  return token ? verifyAdminToken(token) : null
}

export async function GET(req: Request) {
  if (!admin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  try {
    const subreddits = await query(`
      SELECT m.id, m.subreddit_name, m.subscribers, m.niche_tags,
             s.discovery_json, s.requested_action, attempts.submitted_by
        FROM master_subreddits m LEFT JOIN subreddit_maintenance s
          ON LOWER(m.subreddit_name) = s.subreddit_name
        LEFT JOIN (
          SELECT a.subreddit_name,
                 GROUP_CONCAT(
                   DISTINCT CONCAT(
                     COALESCE(NULLIF(u.telegram_username, ''), NULLIF(u.username, ''), u.email, CONCAT('User #', a.user_id)),
                     ' via ', REPLACE(a.source, '_', ' ')
                   )
                   ORDER BY a.created_at SEPARATOR ', '
                 ) AS submitted_by
            FROM subreddit_submission_attempts a
            LEFT JOIN users u ON u.id = a.user_id
           GROUP BY a.subreddit_name
        ) attempts ON attempts.subreddit_name = LOWER(m.subreddit_name)
       WHERE m.status = 'pending' AND COALESCE(s.state, 'active') != 'archived'
       ORDER BY m.created_at DESC`)
    const availability = await query(`
      SELECT subreddit_name, state, dead_checks, last_checked_at, last_evidence,
             archived_at, requested_action
        FROM subreddit_maintenance WHERE state IN ('watch', 'archived')
       ORDER BY archived_at DESC, last_checked_at DESC`)
    return NextResponse.json({ subreddits, availability }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Maintenance queue read error:", err)
    return NextResponse.json({ error: "Review queue temporarily unavailable" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const actor = admin(req)
  if (!actor) return NextResponse.json({ error: "Admin access required" }, { status: 401 })
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const { action } = body
  const name = typeof body.subreddit === "string" ? body.subreddit.trim().toLowerCase() : ""
  const id = Number(body.id)
  if (!["approve", "reject", "restore"].includes(action) ||
      (action === "restore" ? !/^[a-z0-9_]{2,21}$/.test(name) : !Number.isSafeInteger(id) || id <= 0)) {
    return NextResponse.json({ error: "Invalid action or subreddit" }, { status: 400 })
  }
  const connection = await getPool().getConnection()
  let locked = false
  try {
    // Serialize decisions with the worker, preventing approval/rejection races.
    const [lock]: any = await connection.query("SELECT GET_LOCK('ofmreddit_maintenance',0) AS acquired")
    locked = lock[0]?.acquired === 1
    if (!locked) return NextResponse.json({ error: "Maintenance is running. Please retry shortly." }, { status: 409 })
    await connection.beginTransaction()
    let target = name
    if (action === "restore") {
      const [rows]: any = await connection.execute(
        "SELECT state FROM subreddit_maintenance WHERE subreddit_name=? FOR UPDATE", [name],
      )
      if (!rows.length || rows[0].state !== "archived") {
        await connection.rollback()
        return NextResponse.json({ error: "Archived subreddit not found" }, { status: 404 })
      }
      await connection.execute("UPDATE subreddit_maintenance SET requested_action='restore' WHERE subreddit_name=?", [name])
    } else {
      const [rows]: any = await connection.execute("SELECT subreddit_name, status FROM master_subreddits WHERE id=? FOR UPDATE", [id])
      if (!rows.length || rows[0].status !== "pending") {
        await connection.rollback()
        return NextResponse.json({ error: "Pending subreddit not found" }, { status: 404 })
      }
      target = String(rows[0].subreddit_name).trim().toLowerCase()
      if (!/^[a-z0-9_]{2,21}$/.test(target)) {
        await connection.rollback()
        return NextResponse.json({ error: "Invalid stored subreddit name" }, { status: 400 })
      }
      if (action === "approve") {
        const [states]: any = await connection.execute("SELECT state FROM subreddit_maintenance WHERE subreddit_name=?", [target])
        if (states[0]?.state === "archived") {
          await connection.rollback()
          return NextResponse.json({ error: "Restore this archived subreddit first" }, { status: 409 })
        }
        await connection.execute(`INSERT INTO subreddit_maintenance (subreddit_name, requested_action)
          VALUES (?, 'add') ON DUPLICATE KEY UPDATE requested_action='add'`, [target])
      } else {
        await connection.execute("UPDATE master_subreddits SET status='rejected' WHERE id=?", [id])
        await connection.execute("UPDATE subreddit_maintenance SET requested_action=NULL WHERE subreddit_name=?", [target])
      }
    }
    await connection.execute("INSERT INTO subreddit_maintenance_events (subreddit_name, action, detail_json) VALUES (?,?,?)",
      [target, `admin_${action}`, JSON.stringify({ userId: actor.userId })])
    await connection.commit()
    return NextResponse.json({ success: true, queued: action !== "reject" })
  } catch (err) {
    await connection.rollback()
    console.error("Maintenance queue action error:", err)
    return NextResponse.json({ error: "Review action could not be saved" }, { status: 500 })
  } finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK('ofmreddit_maintenance')") }
    finally { connection.release() }
  }
}
