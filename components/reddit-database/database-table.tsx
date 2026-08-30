"use client"

import { useMemo, useState, useRef, useCallback } from "react"
import { SortIcon } from "@/components/reddit-database/icons"

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
  subredditNicheMap?: Map<string, string[]> 
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

export default function DatabaseTable({ headers, rows, sortState, onSort, subredditNicheMap }: Props) {
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({})
  const isResizingRef = useRef(false)

  // Find where the Subreddit and Niche columns are
  const colIndices = useMemo(() => {
    const lower = headers.map(h => h.toLowerCase().trim());
    return {
      subreddit: lower.indexOf("subreddit"),
      niche: lower.indexOf("niche")
    };
  }, [headers]);

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
      // Logic: If sorting the Niche column, we must sort by the mapped tags, not the empty Sheet 1 cell
      let valA = a[col] ?? "";
      let valB = b[col] ?? "";

      if (col === colIndices.niche && subredditNicheMap && colIndices.subreddit !== -1) {
        valA = (subredditNicheMap.get(a[colIndices.subreddit]) || []).join(", ");
        valB = (subredditNicheMap.get(b[colIndices.subreddit]) || []).join(", ");
      }

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
  }, [rows, sortState, colIndices, subredditNicheMap])

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
                  <button 
                    type="button" 
                    onClick={() => {
                      if (!isResizingRef.current) onSort(i)
                    }} 
                    className="group inline-flex items-center gap-1 w-full overflow-hidden text-left"
                  >
                    <span className="truncate">{h}</span>
                    <SortIcon direction={direction} />
                  </button>
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
              {headers.map((_, ci) => {
                let displayValue = row[ci] ?? "";

                // If this is the Niche column, ignore the raw row data and pull from the Map
                if (ci === colIndices.niche && subredditNicheMap && colIndices.subreddit !== -1) {
                  const subName = row[colIndices.subreddit];
                  const niches = subredditNicheMap.get(subName) || [];
                  displayValue = niches.join(", ");
                }

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
                          {displayValue.replace("https://www.reddit.com/r/", "r/")}
                        </a>
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
                  <td key={ci} className="truncate px-4 py-2 text-xs md:text-sm" title={displayValue}>
                    {displayValue}
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