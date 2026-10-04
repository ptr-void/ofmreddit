import { type NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { verifyAdminToken } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1]
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!verifyAdminToken(token)) return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS website_visits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        page_path VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INT NULL,
        INDEX idx_website_visits_user_id (user_id)
      )
    `)
    return NextResponse.json({ success: true, message: "Visit table ready. For existing tables, run scripts/migrate-visit-identity.cjs." })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: "Failed to prepare visit table." }, { status: 500 })
  }
}
