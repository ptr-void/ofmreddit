"use client"

import { useMemo, useState, useRef, useCallback } from "react"
import { Info } from "lucide-react"
import { SortIcon } from "@/components/reddit-database/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { databaseColumnLabel, formatDatabaseMetric, subredditKey, type RowHealth } from "@/lib/reddit-database-display"

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
  rowHealth?: Record<string, RowHealth>
}

const COLUMN_INFO: Record<string, string> = {
  "subreddit name": "Clickable subreddit name. Use the copy icon to copy its Reddit link.",
  verification: "Yes when the scraper detects a creator verification requirement in the subreddit rules or description. The value is refreshed automatically.",
  "total members": "Reddit subscriber count at the last successful refresh, not weekly visitors. Stale rows retain previously stored values.",
  niche: "Manually entered niche tags.",
  "min post karma": "Lowest post karma observed among recent surviving post authors sampled by the scraper. It is not a direct AutoModerator rule lookup.",
  "min comment karma": "Lowest comment karma observed among recent surviving post authors sampled by the scraper. It is not a direct AutoModerator rule lookup.",
  "min total karma": "Lowest combined karma observed among recent surviving post authors sampled by the scraper. It is not a direct AutoModerator rule lookup.",
  "min account age": "Youngest account age observed among recent surviving post authors, shown in days. It is not a direct posting-rule lookup.",
  "hot 1 (weekly)": "Upvote score of the subreddit’s highest-ranked post from Reddit’s weekly Top 10 listing.",
  "hot 2-5 avg (weekly)": "Average upvote score of weekly Top posts ranked 2 through 5.",
  "hot 6-10 avg (weekly)": "Average upvote score of weekly Top posts ranked 6 through 10.",
  "bot bouncer": "The scraper searches for BotBouncer in the moderator list and reports the result to the database. A blank value means the moderator list could not be verified.",
  "cta captions": "Checks surviving recent post titles for question/CTA forms such as ?, would, how, what, do, or. This is observed behavior, not a direct rule lookup.",
}

function columnInfo(header: string) {
  return COLUMN_INFO[header.trim().toLowerCase()] ??
    "This column is not currently documented as a scraper-managed metric."
}

function displaySubredditName(value: string) {
  return value
    .replace(/^https?:\/\/(?:www\.)?reddit\.com\/r\//i, "")
    .replace(/^r\//i, "")
    .replace(/\/+$/, "")
}

function parseSortableValue(value: string) {
  if (!value) return { type: "string" as const, value: "" }
  const clean = value.replace(/,/g, "").trim()
  const numeric = Number(clean)
  if (!Number.isNaN(numeric) && clean !== "") {
    return { type: "number" as const, value: numeric }
  }
  
  // Extract leading numbers from strings like "126d (u/user)"
  const match = clean.match(/^-?\d+(\.\d+)?/)
  if (match) {
    return { type: "number" as const, value: Number(match[0]) }
  }

  return { type: "string" as const, value: value.toLowerCase() }
}

export default function DatabaseTable({ headers, rows, sortState, onSort, rowHealth = {} }: Props) {
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({})
  const isResizingRef = useRef(false)

  const handleResizeStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isResizingRef.current = true

    const startX = e.clientX
    const headerEl = e.currentTarget.parentElement as HTMLElement | null
    const startWidth = headerEl ? headerEl.offsetWidth : (columnWidths[index] || 150)

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = moveEvent.clientX - startX
      const newWidth = Math.max(60, startWidth + delta)
      setColumnWidths(prev => ({
        ...prev,
        [index]: newWidth
      }))
    }

    const onMouseUp = () => {
      setTimeout(() => {
        isResizingRef.current = false
      }, 50)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [columnWidths])

  const sortedRows = useMemo(() => {
    if (!rows.length) return []
    if (sortState.columnIndex === -1 || !sortState.direction) return rows
    const col = sortState.columnIndex
    const dir = sortState.direction
    
    const sorted = [...rows].sort((a, b) => {
      const valA = a[col] ?? ""
      const valB = b[col] ?? ""

      const av = parseSortableValue(valA)
      const bv = parseSortableValue(valB)

      if (av.type === "number" && bv.type === "number") {
        return dir === "asc" ? av.value - bv.value : bv.value - av.value
      }
      const aa = String(av.value)
      const bb = String(bv.value)
      if (aa < bb) return dir === "asc" ? -1 : 1
      if (aa > bb) return dir === "asc" ? 1 : -1
      return 0
    })
    return sorted
  }, [rows, sortState])

  if (!headers.length) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No data found in this sheet.
      </div>
    )
  }

  const hasCustomWidths = Object.keys(columnWidths).length > 0

  return (
    <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card">
      <table 
        className="w-full text-left text-xs md:text-sm"
        style={{ 
          tableLayout: hasCustomWidths ? "fixed" : "auto", 
          minWidth: `${Math.max(900, headers.length * 140)}px` 
        }}
      >
        <thead className="border-b border-border bg-muted/60">
          <tr>
            {headers.map((h, i) => {
              const active = sortState.columnIndex === i
              const direction = active ? sortState.direction : null
              const width = columnWidths[i]
              return (
                <th 
                  key={i} 
                  style={{ width: width ? `${width}px` : undefined }}
                  className="relative px-4 py-3 text-xs font-semibold text-muted-foreground select-none group"
                >
                  <div className="flex w-full items-center gap-1.5 overflow-hidden pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isResizingRef.current) onSort(i)
                      }}
                      className="group inline-flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-left"
                    >
                      <span className="truncate">{databaseColumnLabel(h)}</span>
                      <SortIcon direction={direction} />
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`About ${databaseColumnLabel(h)}`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="center" className="max-w-xs text-xs leading-relaxed">
                        <p className="font-semibold">{databaseColumnLabel(h)}</p>
                        <p className="mt-1 font-normal opacity-90">{columnInfo(h)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {/* Resizer Handle */}
                  <div
                    onMouseDown={(e) => handleResizeStart(i, e)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-0 h-full w-2.5 cursor-col-resize select-none touch-none flex items-center justify-center hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
                    title="Drag to resize column"
                  >
                    <div className="w-[1.5px] h-3.5 bg-border/80 group-hover:bg-primary transition-colors" />
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-6 text-center text-sm text-muted-foreground">
                No rows match the current filter.
              </td>
            </tr>
          )}
          {sortedRows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-border/60 last:border-b-0 odd:bg-background even:bg-muted/30 hover:bg-primary/5"
            >
              {headers.map((header, ci) => {
                const displayValue = row[ci] ?? ""
                const formattedValue = formatDatabaseMetric(header, displayValue)
                const health = header === "Subreddit Name" ? rowHealth[subredditKey(displayValue)] : undefined

                let isLink = false;
                if (typeof displayValue === "string" && displayValue.startsWith("http")) {
                  isLink = true;
                }

                if (isLink) {
                  return (
                    <td key={ci} className="px-4 py-2 text-xs md:text-sm overflow-hidden">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <a 
                          href={displayValue} 
                          target="_blank" 
                          rel="noreferrer"
                          className="truncate text-primary hover:underline"
                          title={displayValue}
                        >
                          {displaySubredditName(displayValue)}
                        </a>
                        {health && (
                          <span
                            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
                            title={health.status === "stale"
                              ? `Latest refresh failed${health.lastAttemptAt ? ` (${health.lastAttemptAt})` : ""}. Showing stored data; this does not confirm the subreddit is dead.`
                              : "This row has no successful scrape checkpoint. Values have not been verified by the current scraper."}
                          >
                            {health.status === "stale" ? "Stale" : "Unverified"}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(displayValue);
                          }}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                          title="Copy Link"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </button>
                      </div>
                    </td>
                  )
                }

                return (
                  <td key={ci} className="truncate px-4 py-2 text-xs md:text-sm" title={formattedValue}>
                    {formattedValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
