import { type NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { verifyToken } from "@/lib/auth"
import { visitIdentityEnabled } from "@/lib/visit-identity"

export async function POST(request: NextRequest) {
  try {
    const { pagePath } = await request.json()

    if (typeof pagePath !== "string" || !pagePath.startsWith("/") || pagePath.startsWith("//") || pagePath.length > 255) {
      return NextResponse.json({ error: "A valid page path is required" }, { status: 400 })
    }

    // Get IP address from headers (works on Vercel)
    const ipAddress = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").slice(0, 45)
    const userAgent = request.headers.get("user-agent") || "unknown"

    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1]
    const account = token ? verifyToken(token) : null
    const userId = account && Number.isSafeInteger(account.userId) && account.userId > 0 ? account.userId : null
    if (await visitIdentityEnabled()) {
      // Never accept an account ID or Telegram handle supplied in the JSON body.
      // A deleted/nonexistent account resolves to NULL rather than a false link.
      await query(
        "INSERT INTO website_visits (page_path, ip_address, user_agent, user_id) VALUES (?, ?, ?, (SELECT id FROM users WHERE id = ? LIMIT 1))",
        [pagePath, ipAddress, userAgent, userId],
      )
    } else {
      await query("INSERT INTO website_visits (page_path, ip_address, user_agent) VALUES (?, ?, ?)", [pagePath, ipAddress, userAgent])
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error tracking visit:", error)
    // Return a 200 even on error so we don't break the client if the db fails
    return NextResponse.json({ success: false, error: "Failed to track visit" }, { status: 200 })
  }
}
