const NUMERIC_COLUMNS = new Set([
  "total members", "min post karma", "min comment karma", "min total karma",
  "min account age", "hot 1 (weekly)", "hot 2-5 avg (weekly)", "hot 6-10 avg (weekly)",
])

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 })

export function formatDatabaseMetric(header: string, value: string): string {
  if (!NUMERIC_COLUMNS.has(header.trim().toLowerCase())) return value
  const trimmed = value.trim()
  if (header.trim().toLowerCase().startsWith("hot ") && (!trimmed || Number(trimmed) === 0)) return "—"
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed)) return value
  const number = Number(trimmed.replace(/,/g, ""))
  return Number.isFinite(number) ? numberFormatter.format(number) : value
}

export function databaseColumnLabel(header: string): string {
  const key = header.trim().toLowerCase()
  if (key.startsWith("min ") && NUMERIC_COLUMNS.has(key)) return `Observed ${header}`
  const weeklyLabels: Record<string, string> = {
    "hot 1 (weekly)": "Top 1 (4-week avg)",
    "hot 2-5 avg (weekly)": "Top 2–5 (4-week avg)",
    "hot 6-10 avg (weekly)": "Top 6–10 (4-week avg)",
  }
  return weeklyLabels[key] || header
}

export function subredditKey(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?reddit\.com\//, "")
    .replace(/^\/?r\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/(?:hot|new|top|rising|controversial)(?:\/.*)?$/, "")
    .replace(/\/+$/, "")
}

const WEEKLY_HEADERS = ["hot 1 (weekly)", "hot 2-5 avg (weekly)", "hot 6-10 avg (weekly)"]
const HISTORY_HEADERS = ["subreddit", "scraped at utc", "hot 1", "hot 2-5 avg", "hot 6-10 avg"]

const WEEK_MS = 7 * 86400_000
const weekStart = (time: number) => {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    - ((date.getUTCDay() + 6) % 7) * 86400_000
}

export function hasWeeklyMetrics(headers: string[]): boolean {
  return headers.some(header => WEEKLY_HEADERS.includes(header.trim().toLowerCase()))
}

/** One latest positive reading per UTC calendar week, not four scrape runs.
 * Current-week readings join from Wednesday; until then the previous four
 * completed weeks stay selected. Missing groups retain their own prior window.
 */
export function applyFourWeekAverages(
  headers: string[], rows: string[][], historyHeaders: string[], historyRows: string[][], now = Date.now(),
): string[][] {
  if (historyHeaders.length !== HISTORY_HEADERS.length ||
      historyHeaders.some((header, index) => header.trim().toLowerCase() !== HISTORY_HEADERS[index])) {
    throw new Error("Weekly Metrics History headers do not match the expected format")
  }
  const normalized = headers.map(header => header.trim().toLowerCase())
  let nameIndex = normalized.findIndex(header => header === "subreddit" || header === "subreddit name")
  if (nameIndex < 0) nameIndex = normalized.indexOf("link")
  if (nameIndex < 0) return rows
  const columns = WEEKLY_HEADERS.map(header => normalized.indexOf(header))
  const currentWeek = weekStart(now), midweek = currentWeek + 2 * 86400_000
  const samples = new Map<string, Map<number, (number | null)[]>>()
  for (const row of historyRows) {
    const name = subredditKey(row[0] || ""), timestamp = row[1] || ""
    if (!name || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(timestamp)) continue
    const time = Date.parse(timestamp)
    if (!Number.isFinite(time) || time > now || time < currentWeek - 4 * WEEK_MS) continue
    const values = columns.map((_, index) => {
      const raw = (row[index + 2] || "").trim(), value = /^\d+$/.test(raw) ? Number(raw) : NaN
      return Number.isSafeInteger(value) && value > 0 ? value : null
    })
    if (!samples.has(name)) samples.set(name, new Map())
    samples.get(name)!.set(time, values)
  }
  return rows.map(row => {
    const observations = [...(samples.get(subredditKey(row[nameIndex] || "")) || new Map()).entries()]
      .sort(([left], [right]) => left - right)
    const restored = [...row]
    columns.forEach((column, metric) => {
      if (column < 0) return
      const weekly = new Map<number, number>()
      for (const [time, values] of observations) {
        const week = weekStart(time), value = values[metric]
        if (value === null || week === currentWeek && time < midweek) continue
        weekly.set(week, value) // Latest positive observation per week, equal week weights.
      }
      const end = weekly.has(currentWeek) ? currentWeek : currentWeek - WEEK_MS
      const values = [...weekly].filter(([week]) => week >= end - 3 * WEEK_MS && week <= end).map(([, value]) => value)
      if (!values.length) return // Keep last published score, never import an arbitrary old period.
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const lower = Math.floor(mean)
      restored[column] = String(mean - lower === 0.5 ? lower + (lower % 2) : Math.round(mean))
    })
    return restored
  })
}

/** Default order follows visible community names, never source-sheet row order. */
export function sortDatabaseRowsByName(headers: string[], rows: string[][]): string[][] {
  const index = headers.findIndex(header => /^(subreddit|subreddit name)$/i.test(header.trim()))
  const nameIndex = index >= 0 ? index : headers.findIndex(header => header.trim().toLowerCase() === "link")
  if (nameIndex < 0) return rows
  return [...rows].sort((a, b) => subredditKey(a[nameIndex] || "").localeCompare(
    subredditKey(b[nameIndex] || ""), "en", { sensitivity: "base", numeric: true },
  ))
}

/** Repair a missing published metric from its latest genuine saved reading.
 * This is retention, not a new observation or an invented current-week score.
 */
export function retainLastKnownWeeklyValues(
  headers: string[], rows: string[][], historyHeaders: string[], historyRows: string[][], now = Date.now(),
): string[][] {
  if (historyHeaders.length !== HISTORY_HEADERS.length || historyHeaders.some((h, i) => h.trim().toLowerCase() !== HISTORY_HEADERS[i])) {
    throw new Error("Weekly Metrics History headers do not match the expected format")
  }
  const normalized = headers.map(header => header.trim().toLowerCase())
  const nameIndex = normalized.findIndex(header => /^(subreddit|subreddit name|link)$/.test(header))
  const columns = WEEKLY_HEADERS.map(header => normalized.indexOf(header))
  const latest = new Map<string, { time: number; value: string }[]>()
  const currentWeek = weekStart(now), midweek = currentWeek + 2 * 86400_000
  for (const row of historyRows) {
    const time = Date.parse(row[1] || "")
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(row[1] || "") || !Number.isFinite(time) || time > now) continue
    if (weekStart(time) === currentWeek && time < midweek) continue
    const key = subredditKey(row[0] || "")
    if (!key) continue
    const values = latest.get(key) || []
    for (let index = 0; index < 3; index++) {
      const raw = String(row[index + 2] || "").trim()
      if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 && (!values[index] || time > values[index].time)) {
        values[index] = { time, value: raw }
      }
    }
    latest.set(key, values)
  }
  return rows.map(row => {
    const next = [...row], saved = latest.get(subredditKey(row[nameIndex] || ""))
    columns.forEach((column, index) => {
      if (column >= 0 && !(Number(String(row[column] || "").replace(/,/g, "")) > 0) && saved?.[index]) next[column] = saved[index].value
    })
    return next
  })
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

/** Missing values stay at the bottom in either direction. */
export function compareDatabaseValues(left: string, right: string, direction: "asc" | "desc"): number {
  const a = left.trim(), b = right.trim()
  const missing = (value: string) => !value || /^(unknown|n\/a|awaiting data|—)$/i.test(value)
  if (missing(a)) return missing(b) ? 0 : 1
  if (missing(b)) return -1
  const number = (value: string) => {
    const match = value.replace(/,/g, "").match(/^-?\d+(?:\.\d+)?/)
    return match ? Number(match[0]) : null
  }
  const an = number(a), bn = number(b)
  const result = an !== null && bn !== null ? an - bn : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  return direction === "asc" ? result : -result
}
