import { NextRequest, NextResponse } from "next/server"
import chromium from "@sparticuz/chromium-min"

export const runtime = "nodejs"

// Keep the ~66 MB Chromium binary out of every Vercel deployment. The min
// package downloads this pinned pack on a cold start and reuses it from /tmp
// for subsequent PDF requests handled by the same function instance.
const CHROMIUM_PACK_URL = process.env.CHROMIUM_PACK_URL ||
  "https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar"

function pickTopN(rows: any[], n: number, key: string) {
  const arr = Array.isArray(rows) ? rows.slice() : []
  arr.sort((a, b) => Number(b?.[key] || 0) - Number(a?.[key] || 0))
  return arr.slice(0, n)
}
function sanitize(html: string | null | undefined) {
  if (!html) return ""
  return String(html)
}
function fmtUTC(s: string) {
  if (!s) return ""
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
function kpiCompute(arrIn: any[], dateRange: string, limit: number, inclPER: boolean) {
  const arr = Array.isArray(arrIn) ? arrIn : []
  const sum = (xs: any[], f: (x: any) => number) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0)
  const toInt = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0)
  const hasMedian = arr.some((r) => typeof r.Median_Upvotes_Per_Post === "number")
  const avgKey = hasMedian ? "Median_Upvotes_Per_Post" : "Avg_Upvotes_Per_Post"
  const totalPosts = toInt(sum(arr, (r) => r.Total_Posts || 0))
  const timeNote = dateRange === "all" ? `up to ${limit} posts` : `in ${dateRange} days (max ${limit})`
  const haveTotals = arr.some((r) => typeof r.Total_Upvotes === "number")
  const overallUpvotes = toInt(haveTotals ? sum(arr, (r) => r.Total_Upvotes || 0) : sum(arr, (r) => (r[avgKey] || 0) * (r.Total_Posts || 0)))
  const topSub = arr.slice().sort((a, b) => (b[avgKey] || 0) - (a[avgKey] || 0))[0] || null
  const opp = arr
    .map((r) => {
      const avg = Number(r[avgKey] || 0)
      const posts = Math.max(1, Number(r.Total_Posts || 0))
      const subs = Math.max(0, Number(r.Subreddit_Subscribers || 0))
      const subFactor = subs > 0 ? Math.log1p(subs) : 1
      const wpi = inclPER ? Math.max(1, Number(r.WPI_Score || 1)) : 1
      const score = (avg * subFactor * wpi) / Math.sqrt(posts)
      return { name: r.Subreddit, score }
    })
    .sort((a, b) => b.score - a.score)[0]
  return {
    totalPosts,
    overallUpvotes,
    topSubreddit: topSub?.Subreddit || "—",
    biggestOpportunity: opp?.name || "—",
    avgKeyLabel: hasMedian ? "Median Upvotes Per Post" : "Avg Upvotes Per Post",
    timeNote,
  }
}
function kpiFallbackHTML({
  dual,
  u1,
  u2,
  username,
  username2,
}: {
  dual: boolean
  u1: ReturnType<typeof kpiCompute>
  u2?: ReturnType<typeof kpiCompute> | null
  username: string
  username2: string
}) {
  if (!dual) {
    return `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Total Posts Analyzed</div>
          <div class="kpi-value">${u1.totalPosts.toLocaleString()}</div>
          <div class="kpi-note">${u1.timeNote}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Overall Upvote Score</div>
          <div class="kpi-value">${u1.overallUpvotes.toLocaleString()}</div>
          <div class="kpi-note">Sum of upvotes across analyzed posts</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Top Subreddit</div>
          <div class="kpi-value">${u1.topSubreddit}</div>
          <div class="kpi-note">Highest ${u1.avgKeyLabel}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Biggest Opportunity</div>
          <div class="kpi-value">${u1.biggestOpportunity}</div>
          <div class="kpi-note">High potential performance but under utilized</div>
        </div>
      </div>
    `
  }
  return `
    <div class="kpi-stack">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Total Posts • ${username || "User 1"}</div>
          <div class="kpi-value">${u1.totalPosts.toLocaleString()}</div>
          <div class="kpi-note">${u1.timeNote}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Overall Upvote Score • ${username || "User 1"}</div>
          <div class="kpi-value">${u1.overallUpvotes.toLocaleString()}</div>
          <div class="kpi-note">Sum of upvotes across analyzed posts</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Top Subreddit • ${username || "User 1"}</div>
          <div class="kpi-value">${u1.topSubreddit}</div>
          <div class="kpi-note">Highest ${u1.avgKeyLabel}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Biggest Opportunity • ${username || "User 1"}</div>
          <div class="kpi-value">${u1.biggestOpportunity}</div>
          <div class="kpi-note">High potential performance but under utilized</div>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Total Posts • ${username2 || "User 2"}</div>
          <div class="kpi-value">${u2?.totalPosts.toLocaleString() || "—"}</div>
          <div class="kpi-note">${u2?.timeNote || ""}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Overall Upvote Score • ${username2 || "User 2"}</div>
          <div class="kpi-value">${u2?.overallUpvotes.toLocaleString() || "—"}</div>
          <div class="kpi-note">Sum of upvotes across analyzed posts</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Top Subreddit • ${username2 || "User 2"}</div>
          <div class="kpi-value">${u2?.topSubreddit || "—"}</div>
          <div class="kpi-note">${u2?.avgKeyLabel ? `Highest ${u2.avgKeyLabel}` : ""}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Biggest Opportunity • ${username2 || "User 2"}</div>
          <div class="kpi-value">${u2?.biggestOpportunity || "—"}</div>
          <div class="kpi-note">High potential performance but under utilized</div>
        </div>
      </div>
    </div>
  `
}

function niceStep(max: number, desired = 6) {
  if (!(max > 0)) return 1
  const raw = max / Math.max(1, desired - 1)
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const scaled = raw / pow
  const nice = scaled >= 5 ? 5 : scaled >= 2 ? 2 : 1
  return nice * pow
}
function makeTicks(max: number, desired = 6) {
  const step = niceStep(max, desired)
  const arr: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) arr.push(Math.round(v))
  if (arr[arr.length - 1] !== Math.round(max)) arr.push(Math.round(max))
  return arr
}

type AxisKey =
  | "Total_Posts"
  | "Avg_Upvotes_Per_Post"
  | "Median_Upvotes"
  | "Avg_Comments_Per_Post"
  | "Total_Upvotes"
  | "Total_Comments"
  | "Subreddit_Subscribers"

type AxisChoice =
  | "Total_Posts"
  | "Average_Upvotes"
  | "Avg_Comments_Per_Post"
  | "Total_Upvotes"
  | "Total_Comments"
  | "Subreddit_Subscribers"

function resolveAxisKey(choice: AxisChoice, avgMetric: "avg" | "median"): AxisKey {
  if (choice === "Average_Upvotes") return avgMetric === "median" ? "Median_Upvotes" : "Avg_Upvotes_Per_Post"
  return choice as AxisKey
}
function labelFor(choice: AxisChoice, avgMetric: "avg" | "median") {
  if (choice === "Average_Upvotes") return avgMetric === "median" ? "Average Upvotes (Median)" : "Average Upvotes (Mean)"
  if (choice === "Total_Posts") return "Number of Posts"
  if (choice === "Avg_Comments_Per_Post") return "Average Root Comments"
  if (choice === "Total_Upvotes") return "Total Upvotes"
  if (choice === "Total_Comments") return "Total Root Comments"
  if (choice === "Subreddit_Subscribers") return "Subscribers"
  return String(choice)
}

function buildScatterFallbackSVG({
  rows1,
  rows2,
  username,
  username2,
  xChoice,
  yChoice,
  avgMetric,
  xMax,
  yMax,
}: {
  rows1: any[]
  rows2?: any[]
  username: string
  username2?: string
  xChoice: AxisChoice
  yChoice: AxisChoice
  avgMetric: "avg" | "median"
  xMax?: number | "auto"
  yMax?: number | "auto"
}) {
  const W = 800
  const H = 420
  const PAD = { l: 60, r: 20, t: 20, b: 50 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const xKey = resolveAxisKey(xChoice, avgMetric)
  const yKey = resolveAxisKey(yChoice, avgMetric)
  const xLabel = labelFor(xChoice, avgMetric)
  const yLabel = labelFor(yChoice, avgMetric)

  const map = (r: any[]) =>
    (r || []).map((x) => ({
      sub: String(x?.Subreddit || ""),
      Total_Posts: Number(x?.Total_Posts || 0),
      Avg_Upvotes_Per_Post: Number(x?.Avg_Upvotes_Per_Post || 0),
      Median_Upvotes: Number(x?.Median_Upvotes || 0),
      Avg_Comments_Per_Post: Number(x?.Avg_Comments_Per_Post || 0),
      Total_Upvotes: Number(x?.Total_Upvotes || 0),
      Total_Comments: Number(x?.Total_Comments || 0),
      Subreddit_Subscribers: Number(x?.Subreddit_Subscribers || 0),
    }))

  const a1 = map(rows1)
  const a2 = map(rows2 || [])
  const all = [...a1, ...a2]

  const rawMaxX = Math.max(0, ...all.map((d) => Number((d as any)[xKey] || 0)))
  const rawMaxY = Math.max(0, ...all.map((d) => Number((d as any)[yKey] || 0)))
  const autoCapX = Math.ceil(((rawMaxX || 10) * 1.05))
  const autoCapY = Math.ceil(((rawMaxY || 10) * 1.05))
  const capX = xMax === "auto" || xMax == null ? autoCapX : Math.max(1, Number(xMax))
  const capY = yMax === "auto" || yMax == null ? autoCapY : Math.max(1, Number(yMax))

  const fa1 = a1.filter((d) => Number((d as any)[xKey]) <= capX && Number((d as any)[yKey]) <= capY)
  const fa2 = a2.filter((d) => Number((d as any)[xKey]) <= capX && Number((d as any)[yKey]) <= capY)

  const sx = (v: number) => PAD.l + (v / capX) * innerW
  const sy = (v: number) => PAD.t + innerH - (v / capY) * innerH

  const maxM = Math.max(0, ...all.map((d) => d.Subreddit_Subscribers))
  const sr = (m: number) => {
    if (maxM <= 0) return 5
    const t = Math.log1p(m) / Math.log1p(maxM)
    return 5 + t * 14
  }

  const axis = `
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t + innerH}" stroke="#9ca3af" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${PAD.t + innerH}" x2="${PAD.l + innerW}" y2="${PAD.t + innerH}" stroke="#9ca3af" stroke-width="1"/>
    <text x="${PAD.l + innerW / 2}" y="${H - 12}" text-anchor="middle" font-size="12" fill="#374151">${xLabel}</text>
    <text x="${16}" y="${PAD.t + innerH / 2}" transform="rotate(-90, 16, ${PAD.t + innerH / 2})" text-anchor="middle" font-size="12" fill="#374151">${yLabel}</text>
  `

  const unitXTicks = xKey === "Total_Posts" && capX <= 15 ? Array.from({ length: Math.max(0, Math.floor(capX)) }, (_, i) => i + 1) : null
  const xt = unitXTicks ?? makeTicks(capX, 6)
  const yt = makeTicks(capY, 6)
  const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })

  const xTicks = xt
    .map(
      (v) =>
        `<line x1="${sx(v)}" y1="${PAD.t + innerH}" x2="${sx(v)}" y2="${PAD.t + innerH + 4}" stroke="#9ca3af"/>
         <text x="${sx(v)}" y="${PAD.t + innerH + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${fmt.format(v)}</text>`
    )
    .join("")
  const yTicks = yt
    .map(
      (v) =>
        `<line x1="${PAD.l - 4}" y1="${sy(v)}" x2="${PAD.l}" y2="${sy(v)}" stroke="#9ca3af"/>
         <text x="${PAD.l - 8}" y="${sy(v) + 3}" text-anchor="end" font-size="10" fill="#6b7280">${fmt.format(v)}</text>`
    )
    .join("")
  const s1 = fa1
    .map(
      (d) =>
        `<circle cx="${sx(Number((d as any)[xKey]))}" cy="${sy(Number((d as any)[yKey]))}" r="${sr(d.Subreddit_Subscribers)}" fill="var(--c1, #3b82f6)" fill-opacity="0.7"><title>${d.sub}</title></circle>`
    )
    .join("")
  const s2 = fa2
    .map(
      (d) =>
        `<circle cx="${sx(Number((d as any)[xKey]))}" cy="${sy(Number((d as any)[yKey]))}" r="${sr(d.Subreddit_Subscribers)}" fill="var(--c2, #14b8a6)" fill-opacity="0.7"><title>${d.sub}</title></circle>`
    )
    .join("")

  const legend = `
    <g>
      <circle cx="${W - 170}" cy="${PAD.t + 12}" r="6" fill="#3b82f6" fill-opacity="0.7"/>
      <text x="${W - 158}" y="${PAD.t + 16}" font-size="12" fill="#374151">${`u/${username || "user"}`}</text>
      ${fa2.length
        ? `<circle cx="${W - 170}" cy="${PAD.t + 26}" r="6" fill="#14b8a6" fill-opacity="0.7"/>
           <text x="${W - 158}" y="${PAD.t + 30}" font-size="12" fill="#374151">${`u/${username2 || "user2"}`}</text>`
        : ""
      }
    </g>
  `

  const allPlottable = [
    ...fa1.map(d => ({
      sub: d.sub,
      xv: Number((d as any)[xKey]) || 0,
      yv: Number((d as any)[yKey]) || 0,
      cx: sx(Number((d as any)[xKey]) || 0),
      cy: sy(Number((d as any)[yKey]) || 0),
      col: "#374151"
    })),
    ...fa2.map(d => ({
      sub: d.sub,
      xv: Number((d as any)[xKey]) || 0,
      yv: Number((d as any)[yKey]) || 0,
      cx: sx(Number((d as any)[xKey]) || 0),
      cy: sy(Number((d as any)[yKey]) || 0),
      col: "#374151"
    })),
  ]

  function median(nums: number[]) {
    if (!nums.length) return 0
    const a = nums.slice().sort((a,b) => a-b)
    const m = Math.floor(a.length/2)
    return a.length % 2 ? a[m] : (a[m-1]+a[m])/2
  }

  const mx = median(allPlottable.map(p => p.xv))
  const my = median(allPlottable.map(p => p.yv))

  const scored = allPlottable.map(p => {
    const dx = (p.xv - mx) / Math.max(1, capX)
    const dy = (p.yv - my) / Math.max(1, capY)
    const outlier = Math.hypot(dx, dy)
    const sizeBoost = maxM > 0 ? Math.log1p((fa1.concat(fa2).find(r => r.sub === p.sub)?.Subreddit_Subscribers || 0)) / Math.log1p(maxM) : 0
    const edgeBoost = Math.max(
      p.xv / Math.max(1, capX),
      p.yv / Math.max(1, capY)
    )
    return { ...p, score: outlier * 0.7 + sizeBoost * 0.2 + edgeBoost * 0.1 }
  }).sort((a,b) => b.score - a.score)

  const maxLabels = Math.min(18, Math.max(6, Math.floor(scored.length * 0.2)))
  const placed: Array<{x1:number,y1:number,x2:number,y2:number}> = []
  const labels: string[] = []

  function fits(b: {x1:number,y1:number,x2:number,y2:number}) {
    for (const bb of placed) {
      if (!(b.x2 < bb.x1 || b.x1 > bb.x2 || b.y2 < bb.y1 || b.y1 > bb.y2)) return false
    }
    return b.x1 >= 0 && b.y1 >= 0 && b.x2 <= W && b.y2 <= H
  }

  const fontSize = 9
  const charW = 5.6

  let count = 0
  for (let i = 0; i < scored.length && count < maxLabels; i++) {
    const p = scored[i]
    const text = p.sub
    const textW = Math.min(160, Math.max(28, text.length * charW))
    const dirLeft = p.cx > (PAD.l + innerW * 0.75)
    const dx = dirLeft ? -6 : 6
    const anchor = dirLeft ? "end" : "start"
    const dy = -4
    const tx = p.cx + dx
    const ty = p.cy + dy
    const x1 = anchor === "end" ? tx - textW : tx
    const x2 = anchor === "end" ? tx : tx + textW
    const y1 = ty - fontSize - 2
    const y2 = ty + 2

    const bbox = { x1, y1, x2, y2 }
    if (!fits(bbox)) continue

    placed.push(bbox)
    labels.push(
      `<g>
         <text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="${fontSize}" fill="${p.col}" font-weight="600">${text}</text>
       </g>`
    )
    count++
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Scatter fallback">
      <style>
        text { font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      </style>
      ${axis}
      ${xTicks}
      ${yTicks}
      ${s1}
      ${s2}
      ${labels.join("")}
      ${legend}
    </svg>
  `
}


function buildBarFallbackSVG({
  rows,
  label,
  metric = "Avg_Upvotes_Per_Post",
  xLabelOffset = 34,
  maxBars = 25
}: {
  rows: any[]
  label: string
  metric?: "Avg_Upvotes_Per_Post" | "Median_Upvotes" | "Total_Upvotes" | "Total_Comments" | "WPI_Score"
  xLabelOffset?: number
  maxBars?: number
}) {
  const data = (Array.isArray(rows) ? rows : [])
    .filter(r => Number.isFinite(Number(r?.[metric])))
    .sort((a, b) => Number(b?.[metric] ?? 0) - Number(a?.[metric] ?? 0))
    .slice(0, maxBars)
    .map(r => ({
      sub: String(r?.Subreddit ?? ""),
      val: Number(r?.[metric] ?? 0),
      posts: Number(r?.Total_Posts ?? 0)
    }))
  const W = 860
  const rowH = 18
  const axisXH = 24
  const PAD = { l: 160, r: 24, t: 14, b: 40 + xLabelOffset }
  const H = Math.max(360, PAD.t + PAD.b + axisXH + data.length * rowH)
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const maxV = Math.ceil(((Math.max(0, ...data.map(d => d.val)) || 10) * 1.05))
  const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
  const sx = (v: number) => PAD.l + (v / maxV) * innerW
  const sy = (i: number) => PAD.t + i * rowH + rowH * 0.7
  const bars = data.map((d, i) => {
    const x1 = PAD.l
    const x2 = sx(d.val)
    const y = PAD.t + i * rowH + 2
    const h = rowH - 4
    return `
      <rect x="${x1}" y="${y}" width="${Math.max(1, x2 - x1)}" height="${h}" fill="var(--c1, #3b82f6)" fill-opacity="0.85"/>
      <text x="${PAD.l - 8}" y="${sy(i)}" text-anchor="end" font-size="11" fill="#374151">${d.sub}</text>
    `
  }).join("")
  const ticks = makeTicks(maxV, 12)
  const xTicks = ticks.map(v => `
    <line x1="${sx(v)}" y1="${PAD.t + innerH}" x2="${sx(v)}" y2="${PAD.t + innerH + 4}" stroke="#9ca3af"/>
    <text x="${sx(v)}" y="${PAD.t + innerH + 16}" font-size="10" fill="#6b7280" text-anchor="middle">${fmt.format(v)}</text>
  `).join("")
  const axis = `
    <line x1="${PAD.l}" y1="${PAD.t + innerH}" x2="${PAD.l + innerW}" y2="${PAD.t + innerH}" stroke="#9ca3af" stroke-width="1"/>
    <text x="${PAD.l + innerW / 2}" y="${H - Math.max(8, xLabelOffset)}" font-size="12" fill="#374151" text-anchor="middle">${label}</text>
  `
  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bar fallback">
      <style>
        text { font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      </style>
      ${axis}
      ${xTicks}
      ${bars}
    </svg>
  `
}

function toUtcDate(s: string) {
  if (!s) return null as Date | null
  if (s.includes("-")) {
    const parts = s.split("-").map((x) => x.trim())
    if (parts.length === 3) {
      const y = Number(parts[0])
      const m = Number(parts[1])
      const d = Number(parts[2])
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return new Date(Date.UTC(y, m - 1, d))
    }
  }
  if (s.includes("/")) {
    const parts = s.split("/").map((x) => x.trim())
    if (parts.length === 3) {
      let a = Number(parts[0])
      let b = Number(parts[1])
      let c = Number(parts[2])
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
        if (c > 1900) return new Date(Date.UTC(c, b - 1, a))
        return new Date(Date.UTC(a, b - 1, c))
      }
    }
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t)) return new Date(t)
  return null as Date | null
}
function keyDay(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
function startOfWeekUTC(d: Date) {
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (dow - 1))
  return start
}
function keyWeek(d: Date) {
  const s = startOfWeekUTC(d)
  return keyDay(s)
}
function keyMonth(d: Date) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}
function summarizeSeries(base: Array<{ date: string;[k: string]: number | string | null }>, keys: string[], how: "avg_upvotes" | "avg_comments" | "total_upvotes") {
  const out: Array<{ date: string; v: number | null }> = []
  let lastAvg: number | null = null
  for (const r of base) {
    const nums: number[] = []
    for (const k of keys) {
      const v = r[k]
      if (typeof v === "number" && isFinite(v)) nums.push(v)
    }
    let val: number | null = null
    if (how === "total_upvotes") val = nums.length ? nums.reduce((a, b) => a + b, 0) : null
    else {
      const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
      val = mean
    }
    if ((how === "avg_upvotes" || how === "avg_comments") && val == null && lastAvg != null) val = lastAvg
    if (val != null) lastAvg = val
    out.push({ date: r.date, v: val })
  }
  return out
}
function aggregateSeries(series: Array<{ date: string; v: number | null }>, granularity: "day" | "week" | "month", how: "avg_upvotes" | "avg_comments" | "total_upvotes") {
  if (granularity === "day") return series
  const buckets: Record<string, { sum: number; count: number }> = {}
  for (const r of series) {
    const d = toUtcDate(r.date)
    if (!d) continue
    const key = granularity === "week" ? keyWeek(d) : keyMonth(d)
    if (!buckets[key]) buckets[key] = { sum: 0, count: 0 }
    if (typeof r.v === "number" && isFinite(r.v)) {
      buckets[key].sum += r.v
      buckets[key].count += 1
    }
  }
  const rows = Object.keys(buckets).sort()
  return rows.map((k) => {
    const b = buckets[k]
    const value = how === "total_upvotes" ? b.sum : b.count ? b.sum / b.count : null
    return { date: k, v: value }
  })
}
function fmtDMY(s: string) {
  const d = toUtcDate(s)
  if (!d) return s
  const day = d.getUTCDate()
  const mon = d.getUTCMonth() + 1
  const yr = d.getUTCFullYear()
  return `${day}/${mon}/${yr}`
}
function buildLineFallbackSVG({
  ts1,
  ts2,
  username,
  username2,
  metric,
  granularity,
  xLabel,
  yLabel
}: {
  ts1: { upvotes: Array<{ date: string;[k: string]: number | string | null }>; comments: Array<{ date: string;[k: string]: number | string | null }>; subreddits: string[] } | null
  ts2?: { upvotes: Array<{ date: string;[k: string]: number | string | null }>; comments: Array<{ date: string;[k: string]: number | string | null }>; subreddits: string[] } | null
  username: string
  username2?: string
  metric: "avg_upvotes" | "avg_comments" | "total_upvotes"
  granularity: "day" | "week" | "month"
  xLabel: string
  yLabel: string
}) {
  if (!ts1) return ""
  const base1 = metric === "avg_comments" ? ts1.comments : ts1.upvotes
  const s1 = aggregateSeries(summarizeSeries(base1, ts1.subreddits || [], metric), granularity, metric)
  const base2 = ts2 ? (metric === "avg_comments" ? ts2.comments : ts2.upvotes) : null
  const s2 = base2 ? aggregateSeries(summarizeSeries(base2, ts2?.subreddits || [], metric), granularity, metric) : null
  const allDates = Array.from(new Set([...(s1 || []).map(r => r.date), ...((s2 || []).map(r => r.date))])).sort()
  const map1 = new Map(s1.map(r => [r.date, r.v]))
  const map2 = s2 ? new Map(s2.map(r => [r.date, r.v])) : null
  const rows = allDates.map(d => ({ date: d, a: Number(map1.get(d) ?? 0) || 0, b: Number(map2?.get(d) ?? 0) || 0 }))
  const maxY = Math.ceil(((Math.max(0, ...rows.map(r => Math.max(r.a, r.b))) || 10) * 1.05))
  const W = 860
  const H = 360
  const PAD = { l: 60, r: 24, t: 20, b: 46 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const sx = (i: number) => PAD.l + (allDates.length <= 1 ? 0 : (i / (allDates.length - 1)) * innerW)
  const sy = (v: number) => PAD.t + innerH - (v / maxY) * innerH
  const xt = allDates
  const yt = makeTicks(maxY, 6)
  const fmtY = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })
  const xTicks = xt.map((d, i) => {
    const x = sx(i)
    return `
      <line x1="${x}" y1="${PAD.t + innerH}" x2="${x}" y2="${PAD.t + innerH + 3}" stroke="#9ca3af"/>
      <text x="${x}" y="${PAD.t + innerH + 14}" font-size="10" text-anchor="middle" fill="#6b7280">${fmtDMY(d)}</text>
    `
  }).join("")
  const yTicks = yt.map(v => `
    <line x1="${PAD.l - 4}" y1="${sy(v)}" x2="${PAD.l}" y2="${sy(v)}" stroke="#9ca3af"/>
    <text x="${PAD.l - 8}" y="${sy(v) + 3}" font-size="10" fill="#6b7280" text-anchor="end">${fmtY.format(v)}</text>
  `).join("")
  const pathOf = (key: "a" | "b", color: string) => {
    if (!rows.length) return ""
    const d = rows.map((row, i) => `${i === 0 ? "M" : "L"}${sx(i)},${sy((row as any)[key] as number)}`).join(" ")
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`
  }
  const dotsOf = (key: "a" | "b", color: string) =>
    rows.map((row, i) => `<circle cx="${sx(i)}" cy="${sy((row as any)[key] as number)}" r="2" fill="${color}" />`).join("")
  const axis = `
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t + innerH}" stroke="#9ca3af" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${PAD.t + innerH}" x2="${PAD.l + innerW}" y2="${PAD.t + innerH}" stroke="#9ca3af" stroke-width="1"/>
    <text x="${PAD.l + innerW / 2}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#374151">${xLabel}</text>
    <text x="16" y="${PAD.t + innerH / 2}" transform="rotate(-90, 16, ${PAD.t + innerH / 2})" text-anchor="middle" font-size="12" fill="#374151">${yLabel}</text>
  `
  const legend = `
    <g>
      <rect x="${W - 220}" y="${PAD.t}" width="12" height="2" fill="#4F46E5"/>
      <text x="${W - 204}" y="${PAD.t + 4}" font-size="12" fill="#374151">${`u/${username || "user1"}`}</text>
      ${ts2 ? `<rect x="${W - 220}" y="${PAD.t + 16}" width="12" height="2" fill="#14b8a6"/><text x="${W - 204}" y="${PAD.t + 20}" font-size="12" fill="#374151">${`u/${username2 || "user2"}`}</text>` : ""}
    </g>
  `
  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Line fallback">
      <style>
        text { font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      </style>
      ${axis}
      ${xTicks}
      ${yTicks}
      ${pathOf("a", "#4F46E5")}
      ${dotsOf("a", "#4F46E5")}
      ${ts2 ? pathOf("b", "#14b8a6") : ""}
      ${ts2 ? dotsOf("b", "#14b8a6") : ""}
      ${legend}
    </svg>
  `
}

function buildInsightsFallbackHTML(insights: string[] | null | undefined) {
  const arr = Array.isArray(insights) ? insights.filter(Boolean) : []
  if (!arr.length) {
    return `<div class="text-foreground/80 italic pb-2" style="font-size:12px">No AI insights were provided for this report.</div>`
  }
  const intro = `<p class="pb-2" style="margin:0">${arr[0]}</p>`
  const list = arr
    .slice(1)
    .map(i => `<li class="pl-2" style="margin:0 0 5px 0; line-height:1.5">${i}</li>`)
    .join("")
  return `
    <div class="space-y-3 text-foreground/90 pb-2" style="font-size:12px">
      ${intro}
      ${list ? `<ul class="list-disc list-inside" style="margin:0 0 5px 0; padding:0 0 0 1rem">${list}</ul>` : ""}
    </div>
  `
}

function collectActiveDates(base: Array<{ date: string; [k: string]: number | string | null }>, keys: string[]) {
  const out: string[] = []
  for (const r of base || []) {
    for (const k of keys || []) {
      const v = r[k]
      if (typeof v === "number" && isFinite(v)) {
        out.push(r.date)
        break
      }
    }
  }
  return out
}
function computeActualDateRange(ts: any): string | null {
  if (!ts || !Array.isArray(ts.subreddits)) return null
  const datesU = collectActiveDates(Array.isArray(ts.upvotes) ? ts.upvotes : [], ts.subreddits)
  const datesC = collectActiveDates(Array.isArray(ts.comments) ? ts.comments : [], ts.subreddits)
  const all = Array.from(new Set([...datesU, ...datesC]))
    .map(d => ({ d, t: toUtcDate(d)?.getTime() ?? NaN }))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)
  if (!all.length) return null
  const first = all[0].d
  const last = all[all.length - 1].d
  return `${fmtDMY(first)}-${fmtDMY(last)}`
}

async function launchBrowser() {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_REGION
  const puppeteer = isServerless ? (await import("puppeteer-core")).default : (await import("puppeteer")).default
  const executablePath = isServerless
    ? await chromium.executablePath(CHROMIUM_PACK_URL)
    : puppeteer.executablePath()
  const browser = await puppeteer.launch({
    args: isServerless ? chromium.args : [],
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 800 }
  })
  return browser
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const title: string = body?.title || "SPA Report"
  const username: string = body?.username || ""
  const username2: string = body?.username2 || ""
  const dateRange: string = body?.dateRange || ""
  const flags = body?.flags || {}
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : []
  const rows2: any[] = Array.isArray(body?.rows2) ? body.rows2 : []
  const caps = body?.captures || {}
  const insightsArr: string[] = Array.isArray(body?.insights) ? body.insights : []

  const ownR = username ? `r/${username.toLowerCase()}` : ""
  const ownU = username ? `u_${username.toLowerCase()}` : ""
  const excluded = new Set<string>()
  const filtered = rows.filter((r: any) => {
    const sub = String(r?.Subreddit || "").toLowerCase()
    if (sub === ownR || sub === ownU) {
      excluded.add(String(r?.Subreddit || ""))
      return false
    }
    return true
  })

  const tableLimit = 15
  const tableN = Math.min(tableLimit, filtered.length)
  const tableRows = pickTopN(filtered, tableN, "Total_Upvotes")

  const css = `
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111827; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 18px 0 8px; }
    .muted { color: #6b7280; }
    .section { page-break-inside: avoid; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
    th { background: #f9fafb; }
    .small { font-size: 11px; }
    .svgwrap svg { width: 100%; height: auto; }
    .note { margin-top: 6px; font-size: 11px; color: #374151; }

    .kpi-stack { display: grid; gap: 16px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .kpi-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    .kpi-title { font-size: 12px; color: #374151; margin-bottom: 4px; }
    .kpi-value { font-size: 14px; font-weight: 700; color: #111827; }
    .kpi-note { font-size: 8px; color: #6b7280; margin-top: 2px; }
  `

  const tableCols: Array<{ key: string; label: string }> = [
    { key: "Subreddit", label: "Subreddit" },
    { key: "Total_Posts", label: "Posts" },
    { key: "Avg_Upvotes_Per_Post", label: "Avg Upvotes" },
    { key: "Avg_Comments_Per_Post", label: "Avg Comments" },
    { key: "Post_Frequency", label: "Post Frequency" }
  ]
  if (flags?.inclMed) tableCols.splice(5, 0, { key: "Median_Upvotes", label: "Median Upvotes" })
  if (flags?.inclVote) tableCols.push({ key: "Total_Upvotes", label: "Total Upvotes" })
  if (flags?.inclComm) tableCols.push({ key: "Total_Comments", label: "Total Comments" })
  if (flags?.inclSubs) tableCols.push({ key: "Subreddit_Subscribers", label: "Members" })
  if (flags?.inclPER) { tableCols.push({ key: "WPI_Score", label: "WPI Score" }); tableCols.push({ key: "WPI_Rating", label: "WPI Rating" }) }
  tableCols.push({ key: "LastDateTimeUTC", label: "Last Post (UTC)" })

  const tableHead = `<tr>${tableCols.map(c => `<th>${c.label}</th>`).join("")}</tr>`
  const tableBody = tableRows.map(r => {
    const tds = tableCols.map(c => {
      let v: any = r?.[c.key]
      if (c.key === "LastDateTimeUTC") {
        v = v ? fmtUTC(String(v)) : ""
      } else if (c.key === "Total_Upvotes" || c.key === "Total_Comments" || c.key === "Subreddit_Subscribers" || c.key === "WPI_Score") {
        const n = Number(v)
        v = Number.isFinite(n) ? n.toLocaleString() : (v ?? "")
      } else if (c.key === "Avg_Upvotes_Per_Post" || c.key === "Avg_Comments_Per_Post") {
        const n = Number(v)
        v = Number.isFinite(n) ? Math.round(n).toLocaleString() : (v ?? "")
      }
      return `<td>${v ?? ""}</td>`
    }).join("")
    return `<tr>${tds}</tr>`
  }).join("")

  const removedList = Array.from(excluded)

  const k1 = kpiCompute(filtered, dateRange, Number.isFinite(body?.limit) ? Number(body.limit) : 1000, !!flags?.inclPER)
  const k2 = rows2 && rows2.length ? kpiCompute(rows2, dateRange, Number.isFinite(body?.limit) ? Number(body.limit) : 1000, !!flags?.inclPER) : null
  const dual = Boolean(k2 && username2)

  const kpiBlock = sanitize(caps?.kpiHTML) || kpiFallbackHTML({ dual, u1: k1, u2: k2, username, username2 })
  const tableBlock = sanitize(caps?.tableHTML) || `<table><thead>${tableHead}</thead><tbody>${tableBody}</tbody></table>`

  const scatterAvgMetric: "avg" | "median" = body?.scatter?.averageMetricKey === "median" ? "median" : "avg"
  const scatterXChoice: AxisChoice = body?.scatter?.xAxisChoice || "Total_Posts"
  const scatterYChoice: AxisChoice = body?.scatter?.yAxisChoice || "Average_Upvotes"
  const xDom = body?.scatter?.xDomain
  const yDom = body?.scatter?.yDomain
  const xMax = Array.isArray(xDom) ? (typeof xDom[1] === "number" ? xDom[1] : "auto") : body?.scatter?.xMax
  const yMax = Array.isArray(yDom) ? (typeof yDom[1] === "number" ? yDom[1] : "auto") : body?.scatter?.yMax

  const scatterBlock = sanitize(caps?.scatterSVG) || buildScatterFallbackSVG({
    rows1: filtered,
    rows2,
    username,
    username2,
    xChoice: scatterXChoice,
    yChoice: scatterYChoice,
    avgMetric: scatterAvgMetric,
    xMax: xMax,
    yMax: yMax
  })

  const barBlock = sanitize(caps?.barSVG) || buildBarFallbackSVG({
    rows: filtered,
    label: flags?.inclMed ? "Median Upvotes" : "Average Upvotes (Mean)",
    metric: flags?.inclMed ? "Median_Upvotes" : "Avg_Upvotes_Per_Post",
    xLabelOffset: 34,
    maxBars: 25
  })

  const metric: "avg_upvotes" | "avg_comments" | "total_upvotes" = body?.lineMetric || "avg_upvotes"
  const granularity: "day" | "week" | "month" = body?.lineGranularity || "day"
  const ts1 = body?.timeSeries || null
  const ts2 = body?.timeSeries2 || null
  let lineBlock = sanitize(caps?.lineSVG)
  if (!lineBlock || lineBlock.length < 100) {
    lineBlock = buildLineFallbackSVG({
      ts1,
      ts2,
      username,
      username2,
      metric,
      granularity,
      xLabel: "Date",
      yLabel: metric === "avg_upvotes" ? "Average Upvotes" : metric === "avg_comments" ? "Average Comments" : "Total Upvotes",
    })
  }

  const dynamicScatterTitle = `Subreddit Performance: ${labelFor(scatterYChoice, scatterAvgMetric)} vs. ${labelFor(scatterXChoice, scatterAvgMetric)}`
  const insightsBlock = buildInsightsFallbackHTML(body?.insights)

  const actualRange = computeActualDateRange(ts1)
  const dateRangeText = actualRange || dateRange
  const now = new Date().toLocaleString("en-US", { hour12: false })
  const noteExclusion = removedList.length ? `Excluded: ${removedList.join(", ")}` : `No exclusions.`

  const html = `
    <html>
      <head>
        <meta charSet="utf-8" />
        <style>${css}</style>
      </head>
      <body>
        <div class="section">
          <h1 style="margin-bottom: 2px;">Subreddit Performance Analysis (SPA)</h1>
          <h1>${title}</h1>
          <div class="muted small">Date Range: ${dateRangeText} • Generated: ${now}${username2 ? ` • Compare vs u/${username2}` : ""}</div>
        </div>
        <div class="section">
          <h2>Section 1: KPIs</h2>
          <div>${kpiBlock}</div>
        </div>
        <div class="section">
          <h2>Section 2: Subreddit Performance Table</h2>
          <div class="card">${tableBlock}</div>
          <div class="note">Showing top ${tableRows.length}${tableRows.length < 25 ? " (reduced to fit)" : ""}. Columns reflect current selections.</div>
        </div>
        <div class="section">
          <h2>Section 3: ${dynamicScatterTitle}</h2>
          <div class="card svgwrap">${scatterBlock}</div>
          <div class="note">${noteExclusion}</div>
        </div>
        <div class="section">
          <h2>Section 4: Bar Chart — Top 25 Subreddits by Upvotes</h2>
          <div class="card svgwrap">${barBlock}</div>
        </div>
        <div class="section">
          <h2>Section 5: Performance Over Time</h2>
          <div class="card svgwrap">${lineBlock}</div>
        </div>
        <div class="section">
          <h2>Section 6: Key Insights</h2>
          <div class="card">${insightsBlock}</div>
        </div>
      </body>
    </html>
  `

  const browser = await launchBrowser()
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: "domcontentloaded" })
  const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" } })
  await browser.close()

  const ab = new ArrayBuffer(pdfBuffer.byteLength)
  new Uint8Array(ab).set(pdfBuffer)

  return new NextResponse(ab, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="spa-report-${username || "user"}.pdf"`
    }
  })
}
