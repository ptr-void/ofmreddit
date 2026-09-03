import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { createWorkbookReader, parseSpreadsheetUrl } from "@/lib/google-sheets-reader"
import { sourceRowHealth } from "@/lib/reddit-database-display"

export const dynamic = "force-dynamic"
export const revalidate = 0

const INTERNAL_HEADERS = new Set(["scraped at utc", "sync status", "sync error"])

const CACHE_FIELDS: Record<string, string> = {
  "total members": "subscribers",
  "min post karma": "min_post_karma",
  "min comment karma": "min_comment_karma",
  "min total karma": "min_combined_karma",
  "min account age": "min_account_age_days",
  "hot 1 (weekly)": "hot_1_weekly",
  "hot 2-5 avg (weekly)": "hot_2_5_weekly_avg",
  "hot 6-10 avg (weekly)": "hot_6_10_weekly_avg",
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/^r\//, "").replace(/\/$/, "")
}

function redditUrl(value: string) {
  const name = value.trim().replace(/^r\//i, "").replace(/^\/+|\/+$/g, "")
  return name ? `https://www.reddit.com/r/${name}/` : ""
}

function yesNo(value: unknown) {
  if (value === 1 || value === true) return "Yes"
  if (value === 0 || value === false) return "No"
  return ""
}

function cachedValue(header: string, cached: any) {
  const key = header.trim().toLowerCase()
  if (key === "subreddit") return String(cached?.subreddit_name ?? "")
  if (key === "link") {
    const name = String(cached?.subreddit_name ?? "").replace(/^r\//i, "")
    return name ? `https://www.reddit.com/r/${name}/` : ""
  }
  if (key === "niche") return String(cached?.niche_tags ?? "")
  if (key === "verification") return yesNo(cached?.requires_verification)
  if (key === "bot bouncer") return yesNo(cached?.has_bot_bouncer)
  if (key === "cta captions") return yesNo(cached?.allows_cta_captions)
  const field = CACHE_FIELDS[key]
  return field ? String(cached?.[field] ?? "") : ""
}

export async function GET() {
  const sheetUrl = process.env.SUBREDDIT_SHEET_URL
  if (!sheetUrl) {
    return NextResponse.json({ error: "Subreddit sheet URL is not configured." }, { status: 500 })
  }
  const parsed = parseSpreadsheetUrl(sheetUrl)
  if (!parsed) {
    return NextResponse.json({ error: "Subreddit sheet URL is invalid." }, { status: 500 })
  }

  try {
    const reader = await createWorkbookReader(parsed.spreadsheetId)
    const sourceSheet = await reader.readByGid(parsed.gid)
    const rowHealth = sourceRowHealth(sourceSheet.headers, sourceSheet.rows)
    const keepIndices = sourceSheet.headers
      .map((header, index) => (INTERNAL_HEADERS.has(header.trim().toLowerCase()) ? -1 : index))
      .filter((index) => index !== -1)
    const mainSheet = {
      title: sourceSheet.title,
      headers: sourceSheet.headers.filter((_, index) => keepIndices.includes(index)),
      rows: sourceSheet.rows.map((row) => keepIndices.map((index) => String(row[index] ?? ""))),
    }

    let cacheRows: any[] = []
    try {
      cacheRows = await query<any>("SELECT * FROM master_subreddits WHERE status = 'approved'")
    } catch (error) {
      console.error("Failed to read optional master_subreddits mirror:", error)
    }

    const subredditIndex = mainSheet.headers.findIndex(
      (header) => header.trim().toLowerCase() === "subreddit",
    )
    if (subredditIndex !== -1 && cacheRows.length > 0) {
      const cacheMap = new Map<string, any>()
      cacheRows.forEach((row) => cacheMap.set(normalize(String(row.subreddit_name ?? "")), row))
      const existing = new Set<string>()
      mainSheet.rows = mainSheet.rows.map((row) => {
        const key = normalize(row[subredditIndex] || "")
        if (key) existing.add(key)
        const cached = cacheMap.get(key)
        if (!cached) return row
        return mainSheet.headers.map((header, index) => row[index] || cachedValue(header, cached))
      })

      cacheRows.forEach((cached) => {
        const key = normalize(String(cached.subreddit_name ?? ""))
        if (!key || existing.has(key)) return
        mainSheet.rows.push(mainSheet.headers.map((header) => cachedValue(header, cached)))
      })
    }

    const linkIndex = mainSheet.headers.findIndex(
      (header) => header.trim().toLowerCase() === "link",
    )
    if (subredditIndex !== -1 && linkIndex !== -1) {
      const keepIndices = mainSheet.headers
        .map((_, index) => (index === subredditIndex ? -1 : index))
        .filter((index) => index !== -1)
      mainSheet.headers = keepIndices.map((index) =>
        index === linkIndex ? "Subreddit Name" : mainSheet.headers[index],
      )
      mainSheet.rows = mainSheet.rows.map((row) => {
        const link = row[linkIndex] || redditUrl(row[subredditIndex] || "")
        return keepIndices.map((index) => (index === linkIndex ? link : row[index] || ""))
      })
    }

    return NextResponse.json(
      { mainSheet, rowHealth },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch sheet data."
    console.error("Failed to build Reddit database response:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
