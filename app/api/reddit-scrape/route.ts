import { NextResponse } from "next/server"
import { createWorkbookReader, parseSpreadsheetUrl } from "@/lib/google-sheets-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  try {
    const sheetUrl = process.env.SUBREDDIT_SHEET_URL
    const analyticsSheetName = process.env.SUBREDDIT_ANALYTICS_SHEET_NAME || "Sheet3"
    const parsed = sheetUrl ? parseSpreadsheetUrl(sheetUrl) : null
    if (!parsed) {
      return NextResponse.json({ error: "Missing or invalid subreddit Sheet URL" }, { status: 500 })
    }

    const reader = await createWorkbookReader(parsed.spreadsheetId)
    const sheet = await reader.readByName(analyticsSheetName)
    if (!sheet.headers.length) {
      return NextResponse.json({ error: `${analyticsSheetName} is empty` }, { status: 404 })
    }

    return NextResponse.json(
      { headers: sheet.headers, rows: sheet.rows },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch analytics data"
    console.error("Failed to fetch analytics sheet:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
