"use client"

import { useMemo, useState, useRef, useCallback } from "react"
import { SortIcon } from "@/components/reddit-database/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { compareDatabaseValues, databaseColumnLabel, formatDatabaseMetric, subredditKey, type RowHealth } from "@/lib/reddit-database-display"

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
  "min post karma": "Three-scrape rolling average of the lowest post karma observed among recent surviving post authors. This is not a direct AutoModerator rule lookup.",
  "min comment karma": "Three-scrape rolling average of the lowest comment karma observed among recent surviving post authors. This is not a direct AutoModerator rule lookup.",
  "min total karma": "Three-scrape rolling average of the lowest combined karma observed among recent surviving post authors. This is not a direct AutoModerator rule lookup.",
  "min account age": "Three-scrape rolling average of the youngest account age observed among recent surviving post authors, shown in days. This is not a direct posting-rule lookup.",
  "hot 1 (weekly)": "Average of the latest positive weekly Top 1 reading in each of four UTC calendar weeks. The current week joins from Wednesday. Empty or zero readings keep the last saved positive value, which may be older than four weeks; incomplete history uses available weeks.",
  "hot 2-5 avg (weekly)": "Four-week average of weekly Top posts ranked 2 through 5, using one latest positive reading per week. Current-week readings join from Wednesday. Empty or zero readings keep the last saved positive value, which may be older than four weeks.",
  "hot 6-10 avg (weekly)": "Four-week average of weekly Top posts ranked 6 through 10, using one latest positive reading per week. Current-week readings join from Wednesday. Empty or zero readings keep the last saved positive value, which may be older than four weeks.",
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
      return compareDatabaseValues(formatDatabaseMetric(headers[col], a[col] ?? ""), formatDatabaseMetric(headers[col], b[col] ?? ""), dir)
    })
    return sorted
  }, [rows, sortState, headers])

  if (!headers.length) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No data found in this sheet.
      </div>
    )
  }

  const widths = headers.map((header, index) => columnWidths[index] ?? (
    index === 0 ? 210 : header.toLowerCase().startsWith("min ") ? 165 :
    header.toLowerCase().startsWith("hot ") ? 155 : header.toLowerCase() === "niche" ? 150 : 115
  ))

  return (
    <div className="relative max-h-[72vh] w-full overflow-auto rounded-xl border border-border bg-card">
      <table
        className="w-full border-separate border-spacing-0 text-left text-xs md:text-sm"
        style={{
          tableLayout: "fixed",
          minWidth: `${widths.reduce((sum, width) => sum + width, 0)}px`
        }}
      >
        <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        <thead className="sticky top-0 z-40 border-b border-border bg-muted">
          <tr>
            {headers.map((h, i) => {
              const active = sortState.columnIndex === i
              const direction = active ? sortState.direction : null
              const width = columnWidths[i]
              const isSubredditColumn = i === 0
              return (
                <th
                  key={i}
                  aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
                  style={{
                    width: width ? `${width}px` : undefined,
                    minWidth: isSubredditColumn ? "190px" : undefined,
                  }}
                  className={`sticky top-0 z-40 bg-muted px-2 py-3 text-xs font-semibold text-muted-foreground select-none group ${
                    isSubredditColumn
                      ? "sticky left-0 top-0 z-50 bg-muted shadow-[4px_0_8px_-5px_rgba(0,0,0,0.65)]"
                      : ""
                  }`}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button"
                        onClick={() => { if (!isResizingRef.current) onSort(i) }}
                        className="inline-flex w-full items-center gap-1 text-left pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Sort by ${databaseColumnLabel(h)}`}>
                        <span>{databaseColumnLabel(h)}</span>
                        <SortIcon direction={direction} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">{columnInfo(h)}</TooltipContent>
                  </Tooltip>
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
              className="group border-b border-border/60 last:border-b-0 odd:bg-background even:bg-card hover:bg-accent"
            >
              {headers.map((header, ci) => {
                const displayValue = row[ci] ?? ""
                const formattedValue = formatDatabaseMetric(header, displayValue)
                const health = header === "Subreddit Name" ? rowHealth[subredditKey(displayValue)] : undefined
                const isSubredditColumn = ci === 0
                const stickyColumnClass = isSubredditColumn
                  ? `sticky left-0 z-20 ${ri % 2 === 0 ? "bg-background" : "bg-card"} group-hover:bg-accent shadow-[4px_0_8px_-5px_rgba(0,0,0,0.65)]`
                  : ""

                let isLink = false;
                if (typeof displayValue === "string" && displayValue.startsWith("http")) {
                  isLink = true;
                }

                if (isLink) {
                  return (
                    <td key={ci} className={`px-2 py-2 text-xs md:text-sm overflow-hidden ${stickyColumnClass}`}>
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
                  <td
                    key={ci}
                    className={`truncate px-2 py-2 text-xs md:text-sm ${stickyColumnClass} ${displayValue === "••••••" ? "pointer-events-none select-none blur-sm" : ""}`}
                    title={displayValue === "••••••" ? undefined : formattedValue}
                  >
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
