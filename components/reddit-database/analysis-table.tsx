"use client"

import { useMemo } from "react"
import { SortIcon } from "@/components/reddit-database/icons"
import { saveAnalysisData } from "@/lib/session-cache/data-analysis-cache"
import { downloadAnalysisAsCSV } from "@/lib/excel/analysis-workbook"

type SortDirection = "asc" | "desc" | null

type SortState = {
  columnIndex: number
  direction: SortDirection
}

type Props = {
  headers: string[]
  rows: string[][]
  sortState: SortState
  onSort: (index: number) => void
}

type AnalysisRow = {
  subreddit: string
  snapshotEngagementRatio: string
  barrierToVisibility: string
  topSlotDiversityIndex: string
  upvoteToRootCommentRatio: string
  simpIntensityScore: string
}

function findIndex(headers: string[], tokens: string[]): number {
  const lowerHeaders = headers.map((h) => h.toLowerCase())
  // First try exact match with all tokens
  let idx = lowerHeaders.findIndex((h) => tokens.every((t) => h.includes(t)))
  if (idx !== -1) return idx

  // If not found, try matching at least one token (more lenient)
  idx = lowerHeaders.findIndex((h) => tokens.some((t) => h.includes(t)))
  return idx
}

function parseNumberCell(value: string | undefined | null): number | null {
  if (value == null) return null
  const cleaned = value.toString().replace(/,/g, "").trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  if (Number.isNaN(n)) return null
  return n
}

function formatNumber(value: number | null, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "NA"
  return value.toFixed(decimals)
}

export default function AnalysisTable({ headers, rows, sortState, onSort }: Props) {
  const analysisRows = useMemo<AnalysisRow[]>(() => {
    if (!rows.length || !headers.length) {
      console.log("[v0] No rows or headers available for analysis")
      return []
    }

    console.log("[v0] Available headers:", headers)
    console.log("[v0] Number of rows:", rows.length)

    const subredditIndex = findIndex(headers, ["subreddit"])
    const activeUsersIndex =
      findIndex(headers, ["active", "user"]) !== -1
        ? findIndex(headers, ["active", "user"])
        : findIndex(headers, ["active"])
    const subscribersIndex =
      findIndex(headers, ["subscriber"]) !== -1 ? findIndex(headers, ["subscriber"]) : findIndex(headers, ["subs"])
    const btvIndex =
      findIndex(headers, ["barrier", "visibility"]) !== -1
        ? findIndex(headers, ["barrier", "visibility"])
        : findIndex(headers, ["btv"])
    const tsdiIndex =
      findIndex(headers, ["top", "slot", "diversity"]) !== -1
        ? findIndex(headers, ["top", "slot", "diversity"])
        : findIndex(headers, ["tsdi"])
    const upvoteToRootRatioIndex =
      findIndex(headers, ["upvote", "root"]) !== -1
        ? findIndex(headers, ["upvote", "root"])
        : findIndex(headers, ["upvote-to-root"])
    const avgUpvotesIndex = findIndex(headers, ["avg", "upvote"])
    const avgRootCommentsIndex = findIndex(headers, ["avg", "root", "comment"])
    const simpScoreIndex =
      findIndex(headers, ["simp", "intensity"]) !== -1
        ? findIndex(headers, ["simp", "intensity"])
        : findIndex(headers, ["simp"])

    console.log("[v0] Column indices found:", {
      subredditIndex,
      activeUsersIndex,
      subscribersIndex,
      btvIndex,
      tsdiIndex,
      upvoteToRootRatioIndex,
      avgUpvotesIndex,
      avgRootCommentsIndex,
      simpScoreIndex,
    })

    if (subredditIndex === -1) {
      console.warn("[v0] Could not find subreddit column")
      return []
    }

    return rows.map((row, rowIdx) => {
      const subreddit = row[subredditIndex] ?? ""

      let snapshotRatio: number | null = null
      if (activeUsersIndex !== -1 && subscribersIndex !== -1) {
        const active = parseNumberCell(row[activeUsersIndex])
        const subs = parseNumberCell(row[subscribersIndex])
        if (active != null && subs != null && subs > 0) {
          snapshotRatio = (active / subs) * 100
        }
      }

      let btv: number | null = null
      if (btvIndex !== -1) {
        btv = parseNumberCell(row[btvIndex])
      }

      let tsdi: number | null = null
      if (tsdiIndex !== -1) {
        tsdi = parseNumberCell(row[tsdiIndex])
      }

      let upvoteRootRatio: number | null = null
      if (upvoteToRootRatioIndex !== -1) {
        upvoteRootRatio = parseNumberCell(row[upvoteToRootRatioIndex])
      } else if (avgUpvotesIndex !== -1 && avgRootCommentsIndex !== -1) {
        const avgUpvotes = parseNumberCell(row[avgUpvotesIndex])
        const avgRootComments = parseNumberCell(row[avgRootCommentsIndex])
        if (avgUpvotes != null && avgRootComments != null && avgRootComments > 0) {
          upvoteRootRatio = avgUpvotes / avgRootComments
        }
      }

      let simpScore: number | null = null
      if (simpScoreIndex !== -1) {
        simpScore = parseNumberCell(row[simpScoreIndex])
      }

      if (rowIdx === 0) {
        console.log("[v0] First row parsed:", {
          subreddit,
          snapshotRatio,
          btv,
          tsdi,
          upvoteRootRatio,
          simpScore,
        })
      }

      return {
        subreddit,
        snapshotEngagementRatio: formatNumber(snapshotRatio, 2),
        barrierToVisibility: formatNumber(btv, 0),
        topSlotDiversityIndex: formatNumber(tsdi, 0),
        upvoteToRootCommentRatio: formatNumber(upvoteRootRatio, 2),
        simpIntensityScore: formatNumber(simpScore, 1),
      }
    })
  }, [headers, rows])

  const sortedRows = useMemo(() => {
    if (!analysisRows.length) return []

    const col = sortState.columnIndex
    const dir = sortState.direction

    if (col === -1 || !dir) return analysisRows

    const getValue = (row: AnalysisRow): string | number => {
      switch (col) {
        case 0:
          return row.subreddit.toLowerCase()
        case 1:
          return Number(row.snapshotEngagementRatio) || Number.NEGATIVE_INFINITY
        case 2:
          return Number(row.barrierToVisibility) || Number.NEGATIVE_INFINITY
        case 3:
          return Number(row.topSlotDiversityIndex) || Number.NEGATIVE_INFINITY
        case 4:
          return Number(row.upvoteToRootCommentRatio) || Number.NEGATIVE_INFINITY
        case 5:
          return Number(row.simpIntensityScore) || Number.NEGATIVE_INFINITY
        default:
          return 0
      }
    }

    const sorted = [...analysisRows].sort((a, b) => {
      const av = getValue(a)
      const bv = getValue(b)

      if (typeof av === "string" && typeof bv === "string") {
        if (av < bv) return dir === "asc" ? -1 : 1
        if (av > bv) return dir === "asc" ? 1 : -1
        return 0
      }

      const an = typeof av === "number" ? av : Number.NEGATIVE_INFINITY
      const bn = typeof bv === "number" ? bv : Number.NEGATIVE_INFINITY

      if (an < bn) return dir === "asc" ? -1 : 1
      if (an > bn) return dir === "asc" ? 1 : -1
      return 0
    })

    return sorted
  }, [analysisRows, sortState])

  const handleAnalyzeAndDownload = () => {
    try {
      saveAnalysisData({
        headers: [
          "Subreddit",
          "Snapshot Engagement Ratio (%)",
          "Barrier to Visibility (BTV)",
          "Top Slot Diversity Index (TSDI)",
          "Upvote to Root Comment Ratio",
          "Simp Intensity Score",
        ],
        rows: sortedRows.map((row) => [
          row.subreddit,
          row.snapshotEngagementRatio,
          row.barrierToVisibility,
          row.topSlotDiversityIndex,
          row.upvoteToRootCommentRatio,
          row.simpIntensityScore,
        ]),
        timestamp: Date.now(),
      })

      const timestamp = new Date().toISOString().split("T")[0]
      downloadAnalysisAsCSV(sortedRows, `analysis-${timestamp}.csv`)
    } catch (err) {
      console.error("Failed to analyze and download:", err)
    }
  }

  if (!analysisRows.length) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No analysis data available. Check the browser console for debugging information.
      </div>
    )
  }

  const headersFixed = [
    "Subreddit",
    "Snapshot Engagement Ratio (%)",
    "Barrier to Visibility (BTV)",
    "Top Slot Diversity Index (TSDI)",
    "Upvote to Root Comment Ratio",
    "Simp Intensity Score",
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleAnalyzeAndDownload}
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          <span>💾</span>
          <span className="ml-2">Analyze & Download</span>
        </button>
      </div>

      <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-[900px] w-full text-left text-xs md:text-sm">
          <thead className="border-b border-border bg-muted/60">
            <tr>
              {headersFixed.map((h, i) => {
                const active = sortState.columnIndex === i
                const direction = active ? sortState.direction : null
                return (
                  <th key={i} className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    <button type="button" onClick={() => onSort(i)} className="group inline-flex items-center gap-1">
                      <span className="whitespace-nowrap">{h}</span>
                      <SortIcon direction={direction} />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={headersFixed.length} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No rows match the current filter.
                </td>
              </tr>
            )}
            {sortedRows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-border/60 last:border-b-0 odd:bg-background even:bg-muted/30 hover:bg-primary/5"
              >
                <td className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">{row.subreddit}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">
                  {row.snapshotEngagementRatio === "NA" ? "NA" : `${row.snapshotEngagementRatio}`}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">{row.barrierToVisibility}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">{row.topSlotDiversityIndex}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">{row.upvoteToRootCommentRatio}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">{row.simpIntensityScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
