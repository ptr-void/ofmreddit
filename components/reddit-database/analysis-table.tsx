"use client"

import { useMemo, useState } from "react"
import { AlertCircle } from "lucide-react"

type SortDirection = "asc" | "desc" | null
type SortState = { columnIndex: number; direction: SortDirection }

type Props = {
  sortState: SortState
  onSort: (index: number) => void
  onShowTiers?: (open: boolean) => void 
}

type AnalysisRow = {
  subreddit: string
  barrierToVisibility: string
  topSlotDiversityIndex: string
  upvoteToRootCommentRatio: string
  minimumPostKarma: string
  minimumCommentKarma: string
  minimumAccountAgeDays: string
}

function SortIcon({ direction }: { direction: SortDirection }) {
  if (!direction) return <span className="opacity-30">↕</span>
  return <span>{direction === "asc" ? "↑" : "↓"}</span>
}

function findColumnIndex(headers: string[], possibleNames: string[]) {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim())
  const lowerPossible = possibleNames.map((p) => p.toLowerCase().trim())
  return lowerHeaders.findIndex((h) => lowerPossible.some((p) => h.includes(p)))
}

export default function AnalysisTable({ sortState, onSort, onShowTiers }: Props) {
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([])
  const [sheetRows, setSheetRows] = useState<string[][]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const handleFetch = async () => {
    setLoading(true)
    setErrorMsg(null)
    const token = localStorage.getItem("token")

    if (!token) {
      setErrorMsg("Please log in to analyze data.")
      setLoading(false)
      return
    }

    try {
      const pre = await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feature: "database", op: "check" }),
      })

      if (!pre.ok) {
        const j = await pre.json()
        if (j.showTiers && onShowTiers) onShowTiers(true)
        throw new Error(j.error || "Limit check failed")
      }

      const res = await fetch("/api/reddit-scrape")
      const text = await res.text()

      if (text.trim().startsWith("<")) {
        throw new Error(`Server error (${res.status}). Check terminal for details.`)
      }

      const data = JSON.parse(text)
      if (!res.ok) throw new Error(data.error || "Failed to fetch data")

      setSheetHeaders(data.headers || [])
      setSheetRows(data.rows || [])
      setHasLoaded(true)

      await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feature: "database", op: "record" }),
      })

    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  const analysisRows = useMemo<AnalysisRow[]>(() => {
    if (!sheetRows.length) return []
    const idx = {
      subreddit: findColumnIndex(sheetHeaders, ["subreddit", "name"]),
      btv: findColumnIndex(sheetHeaders, ["barrier", "btv"]),
      tsdi: findColumnIndex(sheetHeaders, ["top slot", "diversity", "tsdi"]),
      ratio: findColumnIndex(sheetHeaders, ["upvote", "root", "comment", "ratio"]),
      minPostKarma: findColumnIndex(sheetHeaders, ["minimum post karma", "min post karma"]),
      minCommentKarma: findColumnIndex(sheetHeaders, ["minimum comment karma", "min comment karma"]),
      minAccountAge: findColumnIndex(sheetHeaders, ["minimum account age", "age (days)"]),
    }

    return sheetRows.map((row) => ({
      subreddit: row[idx.subreddit] || "Unknown",
      barrierToVisibility: row[idx.btv] || "NA",
      topSlotDiversityIndex: row[idx.tsdi] || "NA",
      upvoteToRootCommentRatio: row[idx.ratio] || "NA",
      minimumPostKarma: row[idx.minPostKarma] || "NA",
      minimumCommentKarma: row[idx.minCommentKarma] || "NA",
      minimumAccountAgeDays: row[idx.minAccountAge] || "NA",
    }))
  }, [sheetRows, sheetHeaders])

  const sortedRows = useMemo(() => {
    const { columnIndex: col, direction: dir } = sortState
    if (col === -1 || !dir) return analysisRows

    return [...analysisRows].sort((a, b) => {
      const valsA = [
        a.subreddit,
        a.barrierToVisibility,
        a.topSlotDiversityIndex,
        a.upvoteToRootCommentRatio,
        a.minimumPostKarma,
        a.minimumCommentKarma,
        a.minimumAccountAgeDays,
      ]
      const valsB = [
        b.subreddit,
        b.barrierToVisibility,
        b.topSlotDiversityIndex,
        b.upvoteToRootCommentRatio,
        b.minimumPostKarma,
        b.minimumCommentKarma,
        b.minimumAccountAgeDays,
      ]

      const getVal = (v: string, isText: boolean) => {
        if (isText) return v
        const num = parseFloat(v.toString().replace(/[%$,]/g, ""))
        return isNaN(num) ? -Infinity : num
      }

      const isText = col === 0
      const va = getVal(valsA[col] ?? "", isText) as any
      const vb = getVal(valsB[col] ?? "", isText) as any

      if (va === vb) return 0
      return dir === "asc" ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    })
  }, [analysisRows, sortState])

  if (!hasLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4">
        <button
          onClick={handleFetch}
          disabled={loading}
          className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-bold shadow-md hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Analyze Data"}
        </button>
        {errorMsg && (
          <div className="flex items-center gap-2 text-sm text-destructive text-center max-w-md">
            <AlertCircle className="h-4 w-4 shrink-0" /> {errorMsg}
          </div>
        )}
      </div>
    )
  }

  const headersFixed = [
    "Subreddit",
    "Barrier to Visibility",
    "TSDI",
    "Upvote/Comment Ratio",
    "Minimum Post Karma",
    "Minimum Comment Karma",
    "Minimum Account Age (days)",
  ]

  return (
    <div className="space-y-4">
      <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-[1100px] w-full text-left text-xs md:text-sm">
          <thead className="border-b border-border bg-muted/60">
            <tr>
              {headersFixed.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => onSort(i)}
                >
                  <div className="flex items-center gap-1">
                    {h} <SortIcon direction={sortState.columnIndex === i ? sortState.direction : null} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/60 odd:bg-background even:bg-muted/30">
                <td className="px-4 py-2 font-medium">{row.subreddit}</td>
                <td className="px-4 py-2">{row.barrierToVisibility}</td>
                <td className="px-4 py-2">{row.topSlotDiversityIndex}</td>
                <td className="px-4 py-2">{row.upvoteToRootCommentRatio}</td>
                <td className="px-4 py-2">{row.minimumPostKarma}</td>
                <td className="px-4 py-2">{row.minimumCommentKarma}</td>
                <td className="px-4 py-2">{row.minimumAccountAgeDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}