"use client"

import { useMemo } from "react"
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
  // Add this new prop to receive the niche map from page.tsx
  subredditNicheMap?: Map<string, string[]> 
}

function parseSortableValue(value: string) {
  if (!value) return { type: "string" as const, value: "" }
  const numeric = Number(value.replace(/,/g, "").trim())
  if (!Number.isNaN(numeric) && value.trim() !== "") {
    return { type: "number" as const, value: numeric }
  }
  return { type: "string" as const, value: value.toLowerCase() }
}

export default function DatabaseTable({ headers, rows, sortState, onSort, subredditNicheMap }: Props) {
  // Find where the Subreddit and Niche columns are
  const colIndices = useMemo(() => {
    const lower = headers.map(h => h.toLowerCase().trim());
    return {
      subreddit: lower.indexOf("subreddit"),
      niche: lower.indexOf("niche")
    };
  }, [headers]);

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

  return (
    <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-card">
      <table className="min-w-[900px] w-full text-left text-xs md:text-sm">
        <thead className="border-b border-border bg-muted/60">
          <tr>
            {headers.map((h, i) => {
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

                return (
                  <td key={ci} className="whitespace-nowrap px-4 py-2 text-xs md:text-sm">
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