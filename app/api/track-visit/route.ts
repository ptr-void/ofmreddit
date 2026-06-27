import { type NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const { pagePath } = await request.json()

    if (!pagePath) {
      return NextResponse.json({ error: "Page path is required" }, { status: 400 })
    }

    // Get IP address from headers (works on Vercel)
    const ipAddress = request.headers.get("x-forwarded-for") || "unknown"
    const userAgent = request.headers.get("user-agent") || "unknown"

    await query(
      "INSERT INTO website_visits (page_path, ip_address, user_agent) VALUES (?, ?, ?)",
      [pagePath, ipAddress, userAgent]
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error tracking visit:", error)
    // Return a 200 even on error so we don't break the client if the db fails
    return NextResponse.json({ success: false, error: "Failed to track visit" }, { status: 200 })
  }
}
