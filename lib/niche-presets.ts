import { createWorkbookReader, parseSpreadsheetUrl } from "@/lib/google-sheets-reader"

const CACHE_MS = 5 * 60 * 1000
const MAX_SELECTED_NICHES = 8
let cached: { expiresAt: number; values: string[] } | null = null

export function parseNicheTags(value: unknown): string[] {
  const seen = new Set<string>()
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag && !seen.has(tag) && !!seen.add(tag))
}

export async function getNichePresets(): Promise<string[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.values
  const sheetUrl = process.env.SUBREDDIT_SHEET_URL
  const parsed = sheetUrl ? parseSpreadsheetUrl(sheetUrl) : null
  if (!parsed) throw new Error("Subreddit sheet URL is not configured")

  const reader = await createWorkbookReader(parsed.spreadsheetId)
  const sheet = await reader.readByGid(parsed.gid)
  const nicheIndex = sheet.headers.findIndex((header) => header.trim().toLowerCase() === "niche")
  if (nicheIndex < 0) throw new Error("The subreddit table has no Niche column")

  const values = Array.from(new Set(
    sheet.rows.flatMap((row) => parseNicheTags(row[nicheIndex])),
  )).sort((a, b) => a.localeCompare(b))
  if (!values.length) throw new Error("No curated niche presets are available")
  cached = { expiresAt: Date.now() + CACHE_MS, values }
  return values
}

export async function validateNicheTags(value: unknown) {
  const selected = parseNicheTags(value)
  if (!selected.length) return { ok: false as const, error: "Select at least one niche tag" }
  if (selected.length > MAX_SELECTED_NICHES) {
    return { ok: false as const, error: `Select no more than ${MAX_SELECTED_NICHES} niche tags` }
  }

  const presets = await getNichePresets()
  const allowed = new Map(presets.map((tag) => [tag.toLowerCase(), tag]))
  const invalid = selected.filter((tag) => !allowed.has(tag))
  if (invalid.length) return { ok: false as const, error: "Select niche tags from the preset list" }
  return { ok: true as const, value: selected.map((tag) => allowed.get(tag)!).join(", ") }
}

