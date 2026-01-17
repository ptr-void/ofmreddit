"use client"

import { useMemo, useState } from "react"


type SortDirection = "asc" | "desc" | null
type SortState = { columnIndex: number; direction: SortDirection }

type Props = {
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


function SortIcon({ direction }: { direction: SortDirection }) {
  if (!direction) return <span className="opacity-30">↕</span>
  return <span>{direction === "asc" ? "↑" : "↓"}</span>
}

function findColumnIndex(headers: string[], possibleNames: string[]) {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim())
  const lowerPossible = possibleNames.map(p => p.toLowerCase().trim())
  return lowerHeaders.findIndex(h => lowerPossible.some(p => h.includes(p)))
}

export default function AnalysisTable({ sortState, onSort }: Props) {
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([])
  const [sheetRows, setSheetRows] = useState<string[][]>([])
  
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const handleFetch = async () => {
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch("/api/reddit-scrape")

      const text = await res.text() 
      
      
      if (text.trim().startsWith("<")) {
        throw new Error(`Server returned HTML error (${res.status}). Check your terminal for compile errors.`)
      }

      
      const data = JSON.parse(text)
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch Sheet3")
      }

      setSheetHeaders(data.headers || [])
      setSheetRows(data.rows || [])
      setHasLoaded(true)

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
      engagement: findColumnIndex(sheetHeaders, ["snapshot", "engagement"]),
      btv: findColumnIndex(sheetHeaders, ["barrier", "btv"]),
      tsdi: findColumnIndex(sheetHeaders, ["diversity", "tsdi"]),
      ratio: findColumnIndex(sheetHeaders, ["upvote", "root", "ratio"]),
      simp: findColumnIndex(sheetHeaders, ["simp", "intensity"])
    }

    return sheetRows.map(row => ({
      subreddit: row[idx.subreddit] || "Unknown",
      snapshotEngagementRatio: row[idx.engagement] || "NA",
      barrierToVisibility: row[idx.btv] || "NA",
      topSlotDiversityIndex: row[idx.tsdi] || "NA",
      upvoteToRootCommentRatio: row[idx.ratio] || "NA",
      simpIntensityScore: row[idx.simp] || "NA",
    }))
  }, [sheetRows, sheetHeaders])

  const sortedRows = useMemo(() => {
    const { columnIndex: col, direction: dir } = sortState
    if (col === -1 || !dir) return analysisRows

    return [...analysisRows].sort((a, b) => {
      const getVal = (r: AnalysisRow) => {
        const vals = [r.subreddit, r.snapshotEngagementRatio, r.barrierToVisibility, r.topSlotDiversityIndex, r.upvoteToRootCommentRatio, r.simpIntensityScore]
        if (col === 0) return vals[col]
        const num = parseFloat(vals[col].toString().replace(/[%$,]/g, ''))
        return isNaN(num) ? -Infinity : num
      }
      return dir === "asc" ? (getVal(a) < getVal(b) ? -1 : 1) : (getVal(a) > getVal(b) ? -1 : 1)
    })
  }, [analysisRows, sortState])

  if (!hasLoaded) {
    return (
      <div className="flex justify-center py-10">
        <button 
          onClick={handleFetch} 
          disabled={loading}
          className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-bold shadow-md hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Analyze Data"}
        </button>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-destructive gap-2">
        <p className="font-bold">Error Loading Data</p>
        <p className="text-sm bg-destructive/10 p-2 rounded max-w-lg text-center">{errorMsg}</p>
        <button onClick={() => setHasLoaded(false)} className="underline mt-2">Try Again</button>
      </div>
    )
  }

  const headersFixed = ["Subreddit", "Snapshot Engagement", "Barrier to Visibility", "TSDI", "Upvote/Comment Ratio", "Simp Score"]

  return (
    <div className="space-y-4">
      <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-[900px] w-full text-left text-xs md:text-sm">
          <thead className="border-b border-border bg-muted/60">
            <tr>
              {headersFixed.map((h, i) => (
                <th key={i} className="px-4 py-3 font-semibold text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => onSort(i)}>
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
                <td className="px-4 py-2">{row.snapshotEngagementRatio}</td>
                <td className="px-4 py-2">{row.barrierToVisibility}</td>
                <td className="px-4 py-2">{row.topSlotDiversityIndex}</td>
                <td className="px-4 py-2">{row.upvoteToRootCommentRatio}</td>
                <td className="px-4 py-2">{row.simpIntensityScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}