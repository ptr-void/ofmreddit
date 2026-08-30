import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  createWorkbookReader,
  parseSpreadsheetUrl,
  type SheetData,
} from "@/lib/google-sheets-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

const ADVANCED_HEADERS = [
  "Min Post Karma",
  "Min Comment Karma",
  "Min Total Karma",
  "Min Account Age",
  "Hot 1 (Weekly)",
  "Hot 2-5 Avg (Weekly)",
  "Hot 6-10 Avg (Weekly)",
  "Bot Bouncer",
  "Requires Verification",
  "CTA Captions",
]

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/^r\//, "").replace(/\/$/, "")
}

function headerLookup(headers: string[]) {
  const lookup = new Map<string, number>()
  headers.forEach((header, index) => lookup.set(header.trim().toLowerCase(), index))
  return lookup
}

function sheetCell(row: string[] | undefined, lookup: Map<string, number>, header: string) {
  if (!row) return ""
  const index = lookup.get(header.toLowerCase())
  return index === undefined ? "" : String(row[index] ?? "").trim()
}

function yesNo(value: string, fallback: unknown) {
  const normalized = value.trim().toLowerCase()
  if (["yes", "true", "1"].includes(normalized)) return "Yes"
  if (["no", "false", "0"].includes(normalized)) return "No"
  if (fallback === 1 || fallback === true) return "Yes"
  if (fallback === 0 || fallback === false) return "No"
  return ""
}

function analyticsRows(sheet: SheetData) {
  const lookup = headerLookup(sheet.headers)
  const subredditIndex = lookup.get("subreddit") ?? 0
  const scrapedIndex = lookup.get("scraped at utc")
  const rows = new Map<string, { row: string[]; scrapedAt: string }>()

  sheet.rows.forEach((row) => {
    const key = normalize(row[subredditIndex] || "")
    if (!key) return
    const scrapedAt = scrapedIndex === undefined ? "" : String(row[scrapedIndex] || "")
    const current = rows.get(key)
    if (!current || scrapedAt >= current.scrapedAt) rows.set(key, { row, scrapedAt })
  })
  return { lookup, rows }
}

function mergedAdvancedValues(
  analyticsRow: string[] | undefined,
  analyticsLookup: Map<string, number>,
  cached: any,
) {
  const value = (header: string, fallback: unknown = "") =>
    sheetCell(analyticsRow, analyticsLookup, header) || String(fallback ?? "")
  const age = value("Minimum Account Age (days)", cached?.min_account_age_days)

  return [
    value("Minimum Post Karma", cached?.min_post_karma),
    value("Minimum Comment Karma", cached?.min_comment_karma),
    value("Minimum Combined Karma", cached?.min_combined_karma),
    age && !age.toLowerCase().endsWith("d") ? `${age}d` : age,
    value("Weekly Top 1 Upvotes", cached?.hot_1_weekly),
    value("Weekly Top 2-5 Avg Upvotes", cached?.hot_2_5_weekly_avg),
    value("Weekly Top 6-10 Avg Upvotes", cached?.hot_6_10_weekly_avg),
    yesNo(sheetCell(analyticsRow, analyticsLookup, "Bot Bouncer Present"), cached?.has_bot_bouncer),
    yesNo(sheetCell(analyticsRow, analyticsLookup, "Requires Verification"), cached?.requires_verification),
    yesNo(sheetCell(analyticsRow, analyticsLookup, "CTA Captions"), cached?.allows_cta_captions),
  ]
}

export async function GET() {
  const sheetUrl = process.env.SUBREDDIT_SHEET_URL
  const tagsGid = process.env.SUBREDDIT_TAGS_GID
  const analyticsSheetName = process.env.SUBREDDIT_ANALYTICS_SHEET_NAME || "Sheet3"

  if (!sheetUrl) {
    return NextResponse.json({ error: "Subreddit sheet URL is not configured." }, { status: 500 })
  }
  if (!tagsGid) {
    return NextResponse.json({ error: "SUBREDDIT_TAGS_GID is not configured." }, { status: 500 })
  }
  const parsed = parseSpreadsheetUrl(sheetUrl)
  if (!parsed) {
    return NextResponse.json({ error: "Subreddit sheet URL is invalid." }, { status: 500 })
  }

  try {
    const reader = await createWorkbookReader(parsed.spreadsheetId)
    const [mainSheet, tagSheet, analyticsSheet] = await Promise.all([
      reader.readByGid(parsed.gid),
      reader.readByGid(tagsGid),
      reader.readByName(analyticsSheetName),
    ])

    // Sheet1 remains the source of truth for base fields, including Niche.
    const excluded = new Set(["bot bouncer present", "bot bouncer"])
    const validIndices = mainSheet.headers
      .map((header, index) => (excluded.has(header.trim().toLowerCase()) ? -1 : index))
      .filter((index) => index !== -1)
    mainSheet.headers = mainSheet.headers.filter((_, index) => validIndices.includes(index))
    mainSheet.rows = mainSheet.rows.map((row) => row.filter((_, index) => validIndices.includes(index)))

    const { lookup: analyticsLookup, rows: analyticsMap } = analyticsRows(analyticsSheet)
    let cacheRows: any[] = []
    try {
      cacheRows = await query<any>("SELECT * FROM master_subreddits WHERE status = 'approved'")
    } catch (error) {
      console.error("Failed to read master_subreddits fallback:", error)
    }
    const cacheMap = new Map<string, any>()
    cacheRows.forEach((row) => cacheMap.set(normalize(row.subreddit_name || ""), row))

    const subredditIndex = mainSheet.headers.findIndex(
      (header) => header.trim().toLowerCase() === "subreddit",
    )
    if (subredditIndex !== -1) {
      mainSheet.headers.push(...ADVANCED_HEADERS)
      const existing = new Set<string>()

      mainSheet.rows = mainSheet.rows.map((row) => {
        const key = normalize(row[subredditIndex] || "")
        existing.add(key)
        row.push(...mergedAdvancedValues(analyticsMap.get(key)?.row, analyticsLookup, cacheMap.get(key)))
        return row
      })

      // Preserve approved crowdsourced DB rows that are absent from Sheet1.
      cacheRows.forEach((cached) => {
        const key = normalize(cached.subreddit_name || "")
        if (!key || existing.has(key)) return
        const row = new Array(mainSheet.headers.length).fill("")
        row[subredditIndex] = cached.subreddit_name
        const nicheIndex = mainSheet.headers.findIndex((header) =>
          ["tags", "niche"].includes(header.trim().toLowerCase()),
        )
        if (nicheIndex !== -1 && cached.niche_tags) row[nicheIndex] = cached.niche_tags
        const advanced = mergedAdvancedValues(analyticsMap.get(key)?.row, analyticsLookup, cached)
        advanced.forEach((value, index) => {
          row[mainSheet.headers.length - ADVANCED_HEADERS.length + index] = value
        })
        mainSheet.rows.push(row)
      })
    }

    return NextResponse.json(
      { mainSheet, tagSheet },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch sheet data."
    console.error("Failed to build Reddit database response:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
