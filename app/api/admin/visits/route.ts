import { type NextRequest, NextResponse } from "next/server"
import { verifyAdminToken } from "@/lib/auth"
import { query } from "@/lib/db"
import { visitIdentityEnabled } from "@/lib/visit-identity"

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

    // Get total visits
    const totalVisitsRes = await query(`SELECT COUNT(*) as count FROM website_visits`)
    const totalVisits = totalVisitsRes[0]?.count || 0

    // Page views include reloads and navigation; unique visitors are distinct IPs.
    const visitsTodayRes = await query(`
      SELECT COUNT(*) as count FROM website_visits 
      WHERE DATE(visited_at) = CURDATE()
    `)
    const visitsToday = visitsTodayRes[0]?.count || 0

    const uniqueVisitorsTodayRes = await query(`
      SELECT COUNT(DISTINCT NULLIF(SUBSTRING_INDEX(ip_address, ',', 1), 'unknown')) as count
      FROM website_visits
      WHERE DATE(visited_at) = CURDATE()
    `)
    const uniqueVisitorsToday = uniqueVisitorsTodayRes[0]?.count || 0

    const accountTrackingEnabled = await visitIdentityEnabled()
    // Only this admin endpoint exposes account details; historical rows remain
    // NULL, with no attempt to match guests to accounts via shared IP addresses.
    const recentVisits = await query(`
      SELECT v.id, v.page_path, v.ip_address, v.user_agent, v.visited_at,
        ${accountTrackingEnabled ? "v.user_id, u.email, u.telegram_username" : "NULL AS user_id, NULL AS email, NULL AS telegram_username"}
      FROM website_visits v
      ${accountTrackingEnabled ? "LEFT JOIN users u ON u.id = v.user_id" : ""}
      ORDER BY v.visited_at DESC, v.id DESC
      LIMIT 50
    `)

    // Get top pages
    const topPages = await query(`
      SELECT page_path, COUNT(*) as visit_count 
      FROM website_visits 
      GROUP BY page_path 
      ORDER BY visit_count DESC 
      LIMIT 10
    `)

    // Keep the complete recorded history so the chart reaches the first visit.
    const visitsByDay = await query(`
      SELECT DATE(visited_at) as date, COUNT(*) as count 
      FROM website_visits 
      GROUP BY DATE(visited_at)
      ORDER BY date ASC
    `)

    return NextResponse.json({
      totalVisits,
      visitsToday,
      uniqueVisitorsToday,
      accountTrackingEnabled,
      recentVisits,
      topPages,
      visitsByDay
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error: any) {
    console.error("Error fetching analytics:", error)
    return NextResponse.json({ error: "Failed to load website visit logs." }, { status: 500 })
  }
}
