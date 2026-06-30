import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function GET() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS website_visits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        page_path VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    return NextResponse.json({ success: true, message: "Table 'website_visits' created successfully!" })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
