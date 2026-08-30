import { NextResponse } from "next/server"
import { query } from "@/lib/db"

type SheetData = {
  title: string
  headers: string[]
  rows: string[][]
}

function parseSheetUrl(url: string): { spreadsheetId: string; gid: string | null } | null {
  const spreadsheetIdRegex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
  const gidRegex = /[#&]gid=([0-9]+)/
  const spreadsheetIdMatch = url.match(spreadsheetIdRegex)
  const gidMatch = url.match(gidRegex)
  if (spreadsheetIdMatch && spreadsheetIdMatch[1]) {
    return {
      spreadsheetId: spreadsheetIdMatch[1],
      gid: gidMatch ? gidMatch[1] : null,
    }
  }
  return null
}

async function fetchSheetData(spreadsheetId: string, gid: string | null, apiKey: string): Promise<SheetData> {
  let sheetName = ""
  const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${apiKey}`
  const metadataResponse = await fetch(metadataUrl)
  if (!metadataResponse.ok) {
    throw new Error("Could not fetch sheet metadata. Please ensure the sheet is public.")
  }
  const metadata = await metadataResponse.json()
  if (gid) {
    const sheet = metadata.sheets.find(
      (s: any) => s.properties.sheetId.toString() === gid,
    )
    if (!sheet) {
      throw new Error(`Sheet with GID ${gid} not found.`)
    }
    sheetName = sheet.properties.title
  } else {
    if (!metadata.sheets || metadata.sheets.length === 0) {
      throw new Error("The spreadsheet contains no sheets.")
    }
    sheetName = metadata.sheets[0].properties.title
  }

  const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    sheetName,
  )}?key=${apiKey}`

  const dataResponse = await fetch(dataUrl)
  if (!dataResponse.ok) {
    throw new Error("Failed to fetch sheet data. Is the sheet shared publicly?")
  }

  const data = await dataResponse.json()
  const values: string[][] = data.values || []
  const headers = values.length > 0 ? values[0] : []
  const rows = values.length > 1 ? values.slice(1) : []

  const titleResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title&key=${apiKey}`,
  )
  const titleData = await titleResponse.json()

  return {
    title: `${titleData.properties.title} - ${sheetName}`,
    headers,
    rows,
  }
}

export async function GET() {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY
  const sheetUrl = process.env.SUBREDDIT_SHEET_URL
  const tagsGid = process.env.SUBREDDIT_TAGS_GID

  if (!apiKey) {
    return NextResponse.json({ error: "Google Sheets API key is not configured." }, { status: 500 })
  }

  if (!sheetUrl) {
    return NextResponse.json({ error: "Subreddit sheet URL is not configured." }, { status: 500 })
  }

  if (!tagsGid) {
    return NextResponse.json({ error: "SUBREDDIT_TAGS_GID is not configured." }, { status: 500 })
  }

  const parsed = parseSheetUrl(sheetUrl)
  if (!parsed) {
    return NextResponse.json({ error: "Subreddit sheet URL is invalid." }, { status: 500 })
  }

  try {
    const mainSheet = await fetchSheetData(
      parsed.spreadsheetId,
      parsed.gid,
      apiKey,
    )

    const tagSheet = await fetchSheetData(
      parsed.spreadsheetId,
      tagsGid,
      apiKey,
    )

    // Strip out duplicate unneeded sheet columns like 'Bot Bouncer Present'
    const excludeHeaders = new Set(["bot bouncer present", "bot bouncer"])
    const validColIndices = mainSheet.headers
      .map((h, i) => excludeHeaders.has(h.trim().toLowerCase()) ? -1 : i)
      .filter(i => i !== -1)

    mainSheet.headers = mainSheet.headers.filter((_, i) => validColIndices.includes(i))
    mainSheet.rows = mainSheet.rows.map(row => row.filter((_, i) => validColIndices.includes(i)))

    // Merge in master_subreddits (Advanced scraping + crowdsourced)
    try {
      const cacheRows = await query<any>("SELECT * FROM master_subreddits WHERE status = 'approved'")
      const cacheMap = new Map<string, any>()
      cacheRows.forEach(row => {
        cacheMap.set(row.subreddit_name.toLowerCase(), row)
      })

      const subColIndex = mainSheet.headers.findIndex(h => h.toLowerCase() === "subreddit")
      if (subColIndex !== -1) {
        mainSheet.headers.push(
          "Min Post Karma", "Min Comment Karma", "Min Total Karma", "Min Account Age",
          "Hot 1 (Weekly)", "Hot 2-5 Avg (Weekly)", "Hot 6-10 Avg (Weekly)", "Bot Bouncer", "Requires Verification", "CTA Captions"
        )
        
        const existingSubs = new Set<string>()

        mainSheet.rows = mainSheet.rows.map(row => {
          let subName = row[subColIndex] || ""
          subName = subName.replace(/^r\//i, "").trim().toLowerCase()
          existingSubs.add(subName)
          
          const cached = cacheMap.get(subName)
          if (cached) {
            row.push(
              `${cached.min_post_karma || ""}`,
              `${cached.min_comment_karma || ""}`,
              `${cached.min_combined_karma || ""}`,
              `${cached.min_account_age_days ? cached.min_account_age_days + "d" : ""}`,
              `${cached.hot_1_weekly || ""}`,
              `${cached.hot_2_5_weekly_avg || ""}`,
              `${cached.hot_6_10_weekly_avg || ""}`,
              cached.has_bot_bouncer ? "Yes" : "No",
              cached.requires_verification ? "Yes" : "No",
              cached.allows_cta_captions === 1 ? "Yes" : cached.allows_cta_captions === 0 ? "No" : ""
            )
          } else {
            row.push("", "", "", "", "", "", "", "", "", "")
          }
          return row
        })

        // Append crowdsourced approved subreddits that aren't in the Google Sheet yet
        cacheRows.forEach(row => {
          const subName = row.subreddit_name.toLowerCase()
          if (!existingSubs.has(subName)) {
            const newRow = new Array(mainSheet.headers.length).fill("")
            newRow[subColIndex] = row.subreddit_name
            // Find the tags column to insert niche tags if it exists
            const tagsColIndex = mainSheet.headers.findIndex(h => h.toLowerCase() === "tags" || h.toLowerCase() === "niche")
            if (tagsColIndex !== -1 && row.niche_tags) {
              newRow[tagsColIndex] = row.niche_tags
            }
            // Fill in our appended columns at the end
            newRow[mainSheet.headers.length - 10] = `${row.min_post_karma || ""}`
            newRow[mainSheet.headers.length - 9] = `${row.min_comment_karma || ""}`
            newRow[mainSheet.headers.length - 8] = `${row.min_combined_karma || ""}`
            newRow[mainSheet.headers.length - 7] = `${row.min_account_age_days ? row.min_account_age_days + "d" : ""}`
            newRow[mainSheet.headers.length - 6] = `${row.hot_1_weekly || ""}`
            newRow[mainSheet.headers.length - 5] = `${row.hot_2_5_weekly_avg || ""}`
            newRow[mainSheet.headers.length - 4] = `${row.hot_6_10_weekly_avg || ""}`
            newRow[mainSheet.headers.length - 3] = row.has_bot_bouncer ? "Yes" : "No"
            newRow[mainSheet.headers.length - 2] = row.requires_verification ? "Yes" : "No"
            newRow[mainSheet.headers.length - 1] = row.allows_cta_captions === 1 ? "Yes" : row.allows_cta_captions === 0 ? "No" : ""
            
            mainSheet.rows.push(newRow)
          }
        })
      }
    } catch (e) {
      console.error("Failed to merge master_subreddits into sheets:", e)
    }

    return NextResponse.json({
      mainSheet,
      tagSheet,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch sheet data."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
