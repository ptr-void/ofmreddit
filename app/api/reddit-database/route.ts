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

    // Merge in cached subreddit metrics
    try {
      const cacheRows = await query<any>("SELECT * FROM subreddit_metrics_cache")
      const cacheMap = new Map<string, any>()
      cacheRows.forEach(row => {
        cacheMap.set(row.subreddit.toLowerCase(), row)
      })

      const subColIndex = mainSheet.headers.findIndex(h => h.toLowerCase() === "subreddit")
      if (subColIndex !== -1) {
        mainSheet.headers.push("Min Post Karma", "Min Comment Karma", "Min Total Karma", "Min Account Age")
        mainSheet.rows = mainSheet.rows.map(row => {
          let subName = row[subColIndex] || ""
          subName = subName.replace(/^r\//i, "").trim().toLowerCase()
          
          const cached = cacheMap.get(subName)
          if (cached) {
            row.push(
              `${cached.min_post_karma} (u/${cached.min_post_karma_user})`,
              `${cached.min_comment_karma} (u/${cached.min_comment_karma_user})`,
              `${cached.min_total_karma} (u/${cached.min_total_karma_user})`,
              `${cached.min_account_age_days}d (u/${cached.min_account_age_user})`
            )
          } else {
            row.push("", "", "", "")
          }
          return row
        })
      }
    } catch (e) {
      console.error("Failed to merge cache metrics into sheets:", e)
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
