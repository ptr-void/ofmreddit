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

    // Get recent visits (last 50)
    const recentVisits = await query(`
      SELECT id, page_path, ip_address, user_agent, visited_at 
      FROM website_visits 
      ORDER BY visited_at DESC 
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
      recentVisits,
      topPages,
      visitsByDay
    })
  } catch (error: any) {
    console.error("Error fetching analytics:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
