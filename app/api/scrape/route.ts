import { type NextRequest, NextResponse } from "next/server"
import { buildWorkbook, type SubredditRow } from "@/lib/excel/buildWorkbook"
import { buildRawWorkbook, type RawPostRow } from "@/lib/excel/buildRawWorkbook"
import { getRedditAccessToken } from "@/lib/reddit-oauth"

export const runtime = "nodejs"

const sessions = new Map<string, { phase: string; fetched: number; total: number; done: boolean }>()

interface RedditPost { data: { author: string; subreddit: string; score: number; num_comments: number; created_utc: number; title: string } }
interface SubredditStats { subreddit: string; totalPosts: number; totalUpvotes: number; totalComments: number; posts: Array<{ score: number; comments: number; created: number }>; lastPostDate: number }
interface RedditApiResponse { data: { children: RedditPost[]; after: string | null } }

function toDateRangeCutoff(value?: string | number | null): number | null {
  if (!value || value === "all" || String(value).toLowerCase() === "all") return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const nowSecs = Math.floor(Date.now() / 1000)
  return nowSecs - n * 86400
}

const getAccessToken = getRedditAccessToken

const SUBS_TTL = 6 * 60 * 60 * 1000
const SUBS_CACHE: Map<string, { v: number; t: number }> = (globalThis as any).__SUBS_CACHE__ ?? ((globalThis as any).__SUBS_CACHE__ = new Map())

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let subCounts: Map<string, number> | undefined

async function fetchSubredditSubs(name: string, token: string): Promise<number> {
  const key = String(name || "").toLowerCase()
  const now = Date.now()
  const hit = SUBS_CACHE.get(key)
  if (hit && now - hit.t < SUBS_TTL) return hit.v
  await sleep(250)
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(name)}/about`
  let tok = token
  let attempt = 0
  let delay = 400
  while (attempt < 3) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditAnalyzer/1.0" } })
    if (res.status === 401) { tok = await getAccessToken(); attempt++; await sleep(delay); delay *= 2; continue }
    if (!res.ok) { attempt++; await sleep(delay); delay *= 2; continue }
    const data = await res.json()
    const v = data?.data?.subscribers ?? 0
    SUBS_CACHE.set(key, { v, t: now })
    return v
  }
  subCounts = subCounts ?? new Map()
  return 0
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sid = searchParams.get("sid")
  const progress = searchParams.get("progress")
  if (sid && progress) {
    const session = sessions.get(sid)
    if (!session) return NextResponse.json({ phase: "Idle", fetched: 0, total: 0, done: false })
    return NextResponse.json(session)
  }
  return NextResponse.json({ error: "Invalid request" }, { status: 400 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, username2, limit = 1000, inclSubs = 0, inclVote = 0, inclComm = 0, inclPER = 0, inclMed = 0, sid, dateRange = "all", exportType, targetUser } = body

    const usageUrl = new URL("/api/usage", request.url).toString()
    const pre = await fetch(usageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
        authorization: request.headers.get("authorization") || ""
      },
      body: JSON.stringify({ feature: "scraper", op: "check" })
    })
    if (!pre.ok) {
      const j = await pre.json().catch(() => ({}))
      return NextResponse.json({ error: j?.error || "Not allowed" }, { status: pre.status })
    }

    if (exportType) {
      const user = targetUser === "u2" ? String(username2 || "").trim() : String(username || "").trim()
      if (!user) return NextResponse.json({ error: "Username is required" }, { status: 400 })
      const processed = await processUser(user, { limit, dateRange, inclSubs, inclVote, inclComm, inclPER, inclMed, sid: sid || `exp_${Date.now()}`, track: false })
      if (exportType === "data") {
        const { buffer, filename } = await buildWorkbook(processed.subredditStats as SubredditRow[], { username: user, inclMed, inclVote, inclComm, inclSubs, inclPER })
        return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"` } })
      } else if (exportType === "raw") {
        const { buffer, filename } = await buildRawWorkbook(processed.rawRows, user, { inclSubs: !!inclSubs })
        return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"` } })
      }
      return NextResponse.json({ error: "Invalid export type" }, { status: 400 })
    }

    if (!username) return NextResponse.json({ error: "Username is required" }, { status: 400 })
    if (!sid) return NextResponse.json({ error: "Session ID is required" }, { status: 400 })

    const result1 = await processUser(String(username).trim(), { limit, dateRange, inclSubs, inclVote, inclComm, inclPER, inclMed, sid, track: true })
    let result2: typeof result1 | null = null
    if (username2 && String(username2).trim() !== "") {
      result2 = await processUser(String(username2).trim(), { limit, dateRange, inclSubs, inclVote, inclComm, inclPER, inclMed, sid, track: true })
    }

    sessions.set(sid, { phase: "Complete", fetched: result1.subredditStats.length, total: result1.subredditStats.length, done: true })

    await fetch(usageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
        authorization: request.headers.get("authorization") || ""
      },
      body: JSON.stringify({ feature: "scraper", op: "record", meta: { username: String(username || "").trim(), username2: String(username2 || "").trim(), dateRange, limit } })
    }).catch(() => {})

    return NextResponse.json({
      datasetSpanDays: result1.datasetSpanDays,
      previewTop10: result1.previewTop10,
      preview: result1.subredditStats,
      preview2: result2 ? result2.subredditStats : undefined,
      timeSeries: result1.timeSeries,
      timeSeries2: result2 ? result2.timeSeries : undefined,
      rawRows: result1.rawRows,
      rawRows2: result2 ? result2.rawRows : undefined
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sid = searchParams.get("sid")
  if (sid) {
    sessions.delete(sid)
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: "Invalid request" }, { status: 400 })
}

async function processUser(
  u: string,
  opts: { limit: number; dateRange: string; inclSubs: number; inclVote: number; inclComm: number; inclPER: number; inclMed: number; sid: string; track: boolean }
) {
  u = u.trim().replace(/^(?:https?:\/\/(?:www\.)?reddit\.com\/)?(?:u|user)\//i, "").replace(/\/$/, "")
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(u)) throw new Error("Enter a valid Reddit username")
  const maxLimit = Math.min(Number(opts.limit) || 1000, 1000)
  const cutoffSecs =
    toDateRangeCutoff(
      opts.dateRange === "all" ? "all" :
      opts.dateRange === "7" ? 7 :
      opts.dateRange === "30" ? 30 :
      opts.dateRange === "60" ? 60 :
      opts.dateRange === "90" ? 90 : "all"
    )

  if (opts.track) sessions.set(opts.sid, { phase: `Fetching posts of ${u}…`, fetched: 0, total: maxLimit, done: false })

  let accessToken = await getAccessToken()
  const posts: RedditPost[] = []
  let after: string | null = null
  while (posts.length < maxLimit) {
    const batchSize = Math.min(100, maxLimit - posts.length)
    const url = `https://oauth.reddit.com/user/${u}/submitted.json?limit=${batchSize}${after ? `&after=${after}` : ""}`
    const doFetch = async (tok: string) => fetch(url, { headers: { Authorization: `Bearer ${tok}`, "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditAnalyzer/1.0" } })
    let response = await doFetch(accessToken)
    if (!response.ok && response.status === 401) { accessToken = await getAccessToken(); response = await doFetch(accessToken) }
    if (!response.ok) {
      if (response.status === 404) throw new Error("User not found")
      throw new Error(`Reddit API error: ${response.statusText} (${response.status})`)
    }
    const data = (await response.json()) as RedditApiResponse
    const children = data?.data?.children || []
    if (children.length === 0) break
    posts.push(...children)
    if (opts.track) sessions.set(opts.sid, { phase: `Fetching posts of ${u}…`, fetched: posts.length, total: maxLimit, done: false })
    after = data?.data?.after
    if (!after) break
    await sleep(1000)
  }

  // Some public profiles return an empty submitted listing through OAuth
  // despite having searchable posts. Use Reddit's author search as a fallback.
  if (posts.length === 0) {
    let searchAfter: string | null = null
    while (posts.length < maxLimit) {
      const url = new URL("https://oauth.reddit.com/search.json")
      url.searchParams.set("q", `author:${u}`)
      url.searchParams.set("sort", "new")
      url.searchParams.set("type", "link")
      url.searchParams.set("include_over_18", "on")
      url.searchParams.set("limit", String(Math.min(100, maxLimit - posts.length)))
      if (searchAfter) url.searchParams.set("after", searchAfter)
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditAnalyzer/1.0" } })
      if (!response.ok) throw new Error(`Reddit author search failed (${response.status})`)
      const data = (await response.json()) as RedditApiResponse
      const matches = (data?.data?.children || []).filter(post => String(post.data?.author || "").toLowerCase() === u.toLowerCase())
      posts.push(...matches)
      if (opts.track) sessions.set(opts.sid, { phase: `Searching posts of ${u}…`, fetched: posts.length, total: maxLimit, done: false })
      searchAfter = data?.data?.after
      if (!searchAfter || !data?.data?.children?.length) break
      await sleep(1000)
    }
  }

  const filtered = cutoffSecs == null ? posts : posts.filter(p => (p?.data?.created_utc || 0) >= cutoffSecs)
  if (filtered.length === 0) throw new Error(posts.length === 0
    ? `Reddit returned no accessible posts for u/${u}. Check the username or try again later.`
    : `No posts by u/${u} were found in the selected date range. Try All Time.`)
  if (opts.track) sessions.set(opts.sid, { phase: `Processing data of ${u}…`, fetched: filtered.length, total: filtered.length, done: false })

  const created = filtered.map(p => p.data.created_utc)
  const nowSecs = Math.floor(Date.now() / 1000)
  const minDate = created.length ? Math.min(...created) : nowSecs
  const maxDate = created.length ? Math.max(...created) : nowSecs
  const datasetSpanDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400))

  const subredditMap = new Map<string, SubredditStats>()
  for (const post of filtered) {
    const subreddit = post.data.subreddit
    if (!subredditMap.has(subreddit)) {
      subredditMap.set(subreddit, { subreddit, totalPosts: 0, totalUpvotes: 0, totalComments: 0, posts: [], lastPostDate: 0 })
    }
    const s = subredditMap.get(subreddit)!
    s.totalPosts++
    s.totalUpvotes += post.data.score
    s.totalComments += post.data.num_comments
    s.posts.push({ score: post.data.score, comments: post.data.num_comments, created: post.data.created_utc })
    s.lastPostDate = Math.max(s.lastPostDate, post.data.created_utc)
  }

  let subredditStats: (SubredditRow & {
    Subreddit_Subscribers?: number
    Post_Frequency: string
    WPI_Score?: number
    WPI_Rating?: string
    Min_Upvotes?: number
    Q1_Upvotes?: number
    Median_Upvotes?: number
    Q3_Upvotes?: number
    Max_Upvotes?: number
  })[] = Array.from(subredditMap.values()).map((stats) => {
    const totalPosts = stats.totalPosts
    const avgUpvotes = totalPosts > 0 ? stats.totalUpvotes / totalPosts : 0
    const avgComments = totalPosts > 0 ? stats.totalComments / totalPosts : 0
    const scores = stats.posts.map((p) => p.score).sort((a, b) => a - b)
    const pct = (arr: number[], p: number) => {
      if (arr.length === 0) return 0
      const pos = (arr.length - 1) * p
      const lo = Math.floor(pos)
      const hi = Math.ceil(pos)
      if (lo === hi) return arr[lo]
      const w = pos - lo
      return arr[lo] * (1 - w) + arr[hi] * w
    }
    const minU = scores.length ? scores[0] : 0
    const q1U = pct(scores, 0.25)
    const medU = pct(scores, 0.5)
    const q3U = pct(scores, 0.75)
    const maxU = scores.length ? scores[scores.length - 1] : 0
    const postsPerDay = totalPosts / Math.max(1, datasetSpanDays)
    const freq = postsPerDay >= 1 ? `${Math.round(postsPerDay * 10) / 10} posts per day` : `1 post per ${Math.max(1, Math.round(1 / Math.max(postsPerDay, 1e-9)))} days`
    return {
      Subreddit: stats.subreddit,
      Total_Posts: totalPosts,
      Avg_Upvotes_Per_Post: Math.round(avgUpvotes * 100) / 100,
      Avg_Comments_Per_Post: Math.round(avgComments * 100) / 100,
      Median_Upvotes: Math.round(medU * 100) / 100,
      Total_Upvotes: stats.totalUpvotes,
      Total_Comments: stats.totalComments,
      LastDateTimeUTC: new Date(stats.lastPostDate * 1000).toISOString(),
      Post_Frequency: freq,
      Min_Upvotes: Math.round(minU),
      Q1_Upvotes: Math.round(q1U),
      Q3_Upvotes: Math.round(q3U),
      Max_Upvotes: Math.round(maxU)
    }
  })

  if (opts.inclSubs) {
    subCounts = new Map<string, number>()
    let i = 0
    for (const name of subredditStats.map((x) => x.Subreddit)) {
      const count = await fetchSubredditSubs(name, await getAccessToken())
      subCounts.set(name, count)
      i++
      if (opts.track) sessions.set(opts.sid, { phase: `Fetching subreddit member counts of ${u}…`, fetched: i, total: subredditStats.length, done: false })
      await sleep(120)
    }
    subredditStats = subredditStats.map((r) => ({ ...r, Subreddit_Subscribers: subCounts?.get(r.Subreddit) ?? 0 }))

    const sum = (a: any[], f: (x: any) => number) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0)
    const totalPostsAll = Math.max(1, sum(subredditStats, (r) => r.Total_Posts || 0))
    const useMedian = !!opts.inclMed
    const wAvgUp = (opts.inclVote ? sum(subredditStats, (r) => r.Total_Upvotes || 0) / totalPostsAll : sum(subredditStats, (r) => (useMedian ? (r.Median_Upvotes || 0) : (r.Avg_Upvotes_Per_Post || 0)) * (r.Total_Posts || 0)) / totalPostsAll)
    const wAvgComm = (opts.inclComm ? sum(subredditStats, (r) => r.Total_Comments || 0) / totalPostsAll : sum(subredditStats, (r) => (r.Avg_Comments_Per_Post || 0) * (r.Total_Posts || 0)) / totalPostsAll)
    const avgPostsPerSub = subredditStats.length ? totalPostsAll / subredditStats.length : 0
    const subsScale = 10000
    const scoreOf = (row: any) => {
      const avgUp = useMedian ? (row.Median_Upvotes || 0) : (row.Avg_Upvotes_Per_Post || 0)
      const avgComm = row.Avg_Comments_Per_Post || 0
      const U = wAvgUp > 0 ? avgUp / wAvgUp : 0
      const C = wAvgComm > 0 ? avgComm / wAvgComm : 0
      let E = 1
      if (opts.inclSubs) {
        const subs = row.Subreddit_Subscribers || 0
        const denom = Math.max(1, subs / subsScale)
        E = (avgUp + 2 * avgComm) / denom
      }
      const postsPerDay = (row.Total_Posts || 0) / Math.max(1, datasetSpanDays)
      const rawV = avgPostsPerSub > 0 ? postsPerDay / avgPostsPerSub : 1
      const V = Math.max(0.75, Math.min(1.25, rawV))
      const score = Math.round(100 * (0.5 * U + 0.3 * C + 0.2 * E) * V)
      const rating = score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Average" : score >= 30 ? "Underperforming" : "Poor"
      return { score, rating }
    }
    subredditStats = subredditStats.map((r) => {
      const { score, rating } = scoreOf(r)
      return { ...r, WPI_Score: score, WPI_Rating: rating }
    })
  }

  subredditStats.sort((a, b) => (b.Avg_Upvotes_Per_Post || 0) - (a.Avg_Upvotes_Per_Post || 0))
  const previewTop10 = subredditStats.slice(0, 10)

  const toExcelUTCDate = (secs: number) => {
    const d = new Date(secs * 1000)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  }

  const rawRows: RawPostRow[] = filtered.map((p) => ({
    Subreddit: p.data.subreddit,
    Upvotes: p.data.score,
    Comments: p.data.num_comments,
    Subreddit_Subscribers: subCounts?.get(p.data.subreddit) ?? 0,
    LastDate: toExcelUTCDate(p.data.created_utc)
  }))

  const byDay = new Map<string, Map<string, { upSum: number; upCnt: number; comSum: number; comCnt: number }>>()
  for (const p of filtered) {
    const sub = p.data.subreddit
    const day = new Date(p.data.created_utc * 1000).toISOString().slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, new Map())
    const dayMap = byDay.get(day)!
    if (!dayMap.has(sub)) dayMap.set(sub, { upSum: 0, upCnt: 0, comSum: 0, comCnt: 0 })
    const b = dayMap.get(sub)!
    b.upSum += p.data.score
    b.upCnt += 1
    b.comSum += p.data.num_comments
    b.comCnt += 1
  }
  const dates = Array.from(byDay.keys()).sort()
  const subsAll = Array.from(new Set(subredditStats.map(r => r.Subreddit)))
  const tsUpvotes: Array<Record<string, number | string | null>> = []
  const tsComments: Array<Record<string, number | string | null>> = []
  for (const d of dates) {
    const upRow: Record<string, number | string | null> = { date: d }
    const comRow: Record<string, number | string | null> = { date: d }
    const dayMap = byDay.get(d)!
    for (const s of subsAll) {
      const cell = dayMap.get(s)
      if (cell && cell.upCnt > 0) {
        upRow[s] = cell.upSum / cell.upCnt
        comRow[s] = cell.comSum / cell.comCnt
      } else {
        upRow[s] = null
        comRow[s] = null
      }
    }
    tsUpvotes.push(upRow)
    tsComments.push(comRow)
  }

  return {
    datasetSpanDays,
    previewTop10,
    subredditStats,
    rawRows,
    timeSeries: { upvotes: tsUpvotes, comments: tsComments, subreddits: subsAll }
  }
}
