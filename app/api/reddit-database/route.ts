import { NextResponse } from "next/server"
import { createWorkbookReader, parseSpreadsheetUrl } from "@/lib/google-sheets-reader"
import { sourceRowHealth } from "@/lib/reddit-database-display"
import { verifyToken } from "@/lib/auth"
import { getActiveTierForUser } from "@/lib/limits"

export const dynamic = "force-dynamic"
export const revalidate = 0

const INTERNAL_HEADERS = new Set(["scraped at utc", "sync status", "sync error"])
const FREE_MASKED_HEADERS = new Set([
  "subreddit name",
  "total members",
  "min post karma",
  "min comment karma",
  "min total karma",
  "min account age",
  "hot 1 (weekly)",
  "hot 2-5 avg (weekly)",
  "hot 6-10 avg (weekly)",
])

function tokenFromRequest(req: Request) {
  const authorization = req.headers.get("authorization") || ""
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]
  if (bearer) return bearer
  const tokenCookie = (req.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("token="))
  return tokenCookie ? decodeURIComponent(tokenCookie.split("=").slice(1).join("=")) : null
}

function redditUrl(value: string) {
  const name = value.trim().replace(/^r\//i, "").replace(/^\/+|\/+$/g, "")
  return name ? `https://www.reddit.com/r/${name}/` : ""
}

export async function GET(req: Request) {
  const token = tokenFromRequest(req)
  const account = token ? verifyToken(token) : null
  if (!account?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tier = await getActiveTierForUser(account.userId)
  const freePreview = Number(tier?.id || 0) === 1
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
    const statusIndex = sourceSheet.headers.findIndex(header => header.trim().toLowerCase() === "sync status")
    sourceSheet.rows = sourceSheet.rows.filter(
      row => String(row[statusIndex] || "").trim().toLowerCase() !== "archived",
    )
    const rowHealth = sourceRowHealth(sourceSheet.headers, sourceSheet.rows)
    const keepIndices = sourceSheet.headers
      .map((header, index) => (INTERNAL_HEADERS.has(header.trim().toLowerCase()) ? -1 : index))
      .filter((index) => index !== -1)
    const mainSheet = {
      title: sourceSheet.title,
      headers: sourceSheet.headers.filter((_, index) => keepIndices.includes(index)),
      rows: sourceSheet.rows.map((row) => keepIndices.map((index) => String(row[index] ?? ""))),
    }

    const subredditIndex = mainSheet.headers.findIndex(
      (header) => header.trim().toLowerCase() === "subreddit",
    )
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

    const maskedColumnIndices = freePreview
      ? mainSheet.headers
          .map((header, index) => (FREE_MASKED_HEADERS.has(header.trim().toLowerCase()) ? index : -1))
          .filter((index) => index >= 0)
      : []
    if (freePreview) {
      const masked = new Set(maskedColumnIndices)
      mainSheet.rows = mainSheet.rows.map((row) =>
        row.map((value, index) => (masked.has(index) && value ? "••••••" : value)),
      )
    }

    return NextResponse.json(
      { mainSheet, rowHealth: freePreview ? {} : rowHealth, freePreview, maskedColumnIndices },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch sheet data."
    console.error("Failed to build Reddit database response:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
