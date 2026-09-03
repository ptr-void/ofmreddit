const NUMERIC_COLUMNS = new Set([
  "total members", "min post karma", "min comment karma", "min total karma",
  "min account age", "hot 1 (weekly)", "hot 2-5 avg (weekly)", "hot 6-10 avg (weekly)",
])

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 })

export function formatDatabaseMetric(header: string, value: string): string {
  if (!NUMERIC_COLUMNS.has(header.trim().toLowerCase())) return value
  const trimmed = value.trim()
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed)) return value
  const number = Number(trimmed.replace(/,/g, ""))
  return Number.isFinite(number) ? numberFormatter.format(number) : value
}

export function databaseColumnLabel(header: string): string {
  const key = header.trim().toLowerCase()
  if (key.startsWith("min ") && NUMERIC_COLUMNS.has(key)) return `Observed ${header}`
  return header
}

export function subredditKey(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?reddit\.com\//, "")
    .replace(/^\/?r\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
}

export type RowHealth = { status: "stale" | "unverified"; lastAttemptAt: string }

export function sourceRowHealth(headers: string[], rows: string[][]): Record<string, RowHealth> {
  const normalized = headers.map((header) => header.trim().toLowerCase())
  const nameIndex = normalized.indexOf("subreddit")
  const statusIndex = normalized.indexOf("sync status")
  const timeIndex = normalized.indexOf("scraped at utc")
  const result: Record<string, RowHealth> = Object.create(null)
  if (nameIndex < 0) return result
  for (const row of rows) {
    const key = subredditKey(row[nameIndex] || "")
    if (!key) continue
    const status = (row[statusIndex] || "").trim().toLowerCase()
    if (status === "success") continue
    result[key] = {
      status: status ? "stale" : "unverified",
      lastAttemptAt: row[timeIndex] || "",
    }
  }
  return result
}
