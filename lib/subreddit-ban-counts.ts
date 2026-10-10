import { query } from "@/lib/db"

export type BanDetectionCounts = {
  today: number
  last7Days: number
  asOf: string
  todayStart: string
  weekStart: string
  timezone: "UTC"
}

export async function getBanDetectionCounts(now = new Date()): Promise<BanDetectionCounts> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const week = new Date(now.getTime() - 7 * 86400_000)
  // Unique names in each period, not the number of retries or archive actions.
  const rows = await query<{ today: number | string; last7Days: number | string }>(`
    SELECT COUNT(DISTINCT CASE WHEN created_at >= FROM_UNIXTIME(?) THEN LOWER(subreddit_name) END) AS today,
           COUNT(DISTINCT LOWER(subreddit_name)) AS last7Days
      FROM subreddit_maintenance_events
     WHERE action = 'banned_detected' AND created_at >= FROM_UNIXTIME(?) AND created_at <= FROM_UNIXTIME(?)`,
    [today.getTime() / 1000, week.getTime() / 1000, now.getTime() / 1000])
  const row = rows[0]
  if (!row || ![row.today, row.last7Days].every(value =>
    (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0)) {
    throw new Error("Invalid ban detection counts")
  }
  if (Number(row.today) > Number(row.last7Days)) throw new Error("Inconsistent ban detection counts")
  return { today: Number(row.today), last7Days: Number(row.last7Days), asOf: now.toISOString(),
    todayStart: today.toISOString(), weekStart: week.toISOString(), timezone: "UTC" }
}
