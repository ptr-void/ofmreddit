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
  return header
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
const missingWeekly = (value: string | undefined) => !value?.trim() || Number(value) === 0

export function needsWeeklyHistory(headers: string[], rows: string[][]): boolean {
  const columns = headers.map(header => header.trim().toLowerCase())
    .map((header, index) => WEEKLY_HEADERS.includes(header) ? index : -1).filter(index => index >= 0)
  return rows.some(row => columns.some(index => missingWeekly(row[index])))
}

/** Fill only missing weekly cells from the same latest-three-positive mean used by the scraper. */
export function restoreWeeklyAverages(
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
  const samples = new Map<string, Map<number, (number | null)[]>>()
  for (const row of historyRows) {
    const name = subredditKey(row[0] || "")
    const timestamp = row[1] || ""
    // Require a timestamp with an explicit UTC offset, not locale-dependent dates.
    if (!name || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(timestamp)) continue
    const time = Date.parse(timestamp)
    if (!Number.isFinite(time) || time > now) continue
    const values = columns.map((_, index) => {
      const raw = (row[index + 2] || "").trim()
      const value = /^\d+$/.test(raw) ? Number(raw) : NaN
      return Number.isSafeInteger(value) && value > 0 ? value : null
    })
    if (!samples.has(name)) samples.set(name, new Map())
    samples.get(name)!.set(time, values) // Rerun timestamps count once, as in the repair worker.
  }
  return rows.map(row => {
    const observations = [...(samples.get(subredditKey(row[nameIndex] || "")) || new Map()).entries()]
      .sort(([left], [right]) => left - right).map(([, values]) => values)
    const restored = [...row]
    columns.forEach((column, metric) => {
      if (column < 0 || !missingWeekly(row[column])) return
      const positive = observations.map(values => values[metric])
        .filter((value): value is number => value !== null).slice(-3)
      if (!positive.length) return
      const mean = positive.reduce((sum, value) => sum + value, 0) / positive.length
      // Python's round uses ties-to-even; match the scraper rather than rounding .5 upward.
      const lower = Math.floor(mean)
      restored[column] = String(mean - lower === 0.5 ? lower + (lower % 2) : Math.round(mean))
    })
    return restored
  })
}

export type WeeklyBaseline = { value: number; start: string; end: string; observedAt: string; postCount: number }
export type WeeklyBaselines = Record<string, Record<string, WeeklyBaseline>>
const BASELINE_HEADERS = ["Subreddit", "Metric", "Window Start UTC", "Window End UTC", "Observed At UTC", "Score", "Post Count", "Post IDs JSON"]

/** A dated historical fallback is separate from live observations and never overwrites a weekly average. */
export function applyHistoricalWeeklyBaselines(
  headers: string[], rows: string[][], baselineHeaders: string[], baselineRows: string[][], now = Date.now(),
): { rows: string[][]; baselines: WeeklyBaselines } {
  if (baselineHeaders.length !== BASELINE_HEADERS.length ||
      baselineHeaders.some((header, index) => header !== BASELINE_HEADERS[index])) {
    throw new Error("Weekly Metric Baselines headers do not match the expected format")
  }
  const normalized = headers.map(header => header.trim().toLowerCase())
  const nameIndex = normalized.findIndex(header => header === "subreddit" || header === "subreddit name")
  const recorded: WeeklyBaselines = Object.create(null)
  const baselines: WeeklyBaselines = Object.create(null)
  for (const row of baselineRows) {
    const name = subredditKey(row[0] || ""), metric = (row[1] || "").toLowerCase()
    const metricIndex = WEEKLY_HEADERS.indexOf(metric)
    const dates = [row[2], row[3], row[4]]
    if (!name || metricIndex < 0 || dates.some(value => !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/.test(value || ""))) continue
    const [start, end, observed] = dates.map(Date.parse)
    const value = /^\d+$/.test(row[5] || "") ? Number(row[5]) : NaN
    const postCount = /^\d+$/.test(row[6] || "") ? Number(row[6]) : NaN
    if (!Number.isSafeInteger(value) || value <= 0 || !Number.isSafeInteger(postCount) || postCount < [1, 2, 6][metricIndex] ||
        ![start, end, observed].every(Number.isFinite) || end - start !== 7 * 86400_000 ||
        end >= now - 7 * 86400_000 || observed < end || observed > now) continue
    try {
      const ids = JSON.parse(row[7] || "")
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id) ||
          new Set(ids).size !== ids.length || ids.length !== Math.min(postCount, 10)) continue
    } catch { continue }
    if (!recorded[name]) recorded[name] = Object.create(null)
    const previous = recorded[name][metric]
    if (!previous || observed > Date.parse(previous.observedAt)) {
      recorded[name][metric] = { value, start: row[2], end: row[3], observedAt: row[4], postCount }
    }
  }
  return { baselines, rows: rows.map(row => {
    const name = subredditKey(row[nameIndex] || "")
    const restored = [...row]
    normalized.forEach((metric, index) => {
      const baseline = recorded[name]?.[metric]
      if (!baseline || !missingWeekly(row[index])) return
      restored[index] = String(baseline.value)
      if (!baselines[name]) baselines[name] = Object.create(null)
      baselines[name][metric] = baseline
    })
    return restored
  }) }
}

export function weeklyBaselineLabel(baseline: WeeklyBaseline): string {
  const start = new Date(baseline.start), end = new Date(baseline.end)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const date = (value: Date, year: boolean) => new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", ...(year ? { year: "numeric" as const } : {}), timeZone: "UTC",
  }).format(value)
  if (!sameYear) return `Historical · ${date(start, true)}–${date(end, true)}`
  const endLabel = start.getUTCMonth() === end.getUTCMonth() ? String(end.getUTCDate()) : date(end, false)
  return `Historical · ${date(start, false)}–${endLabel}, ${end.getUTCFullYear()}`
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
