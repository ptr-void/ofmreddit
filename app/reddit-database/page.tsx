"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshIcon, WarningIcon } from "@/components/reddit-database/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select2"
import DatabaseTable from "@/components/reddit-database/database-table"
import SubmitSubredditModal from "@/components/reddit-database/submit-subreddit-modal"
import s from "@/styles/scraper.module.css"

type SheetData = {
  title: string
  headers: string[]
  rows: string[][]
}

type ApiResponse = { mainSheet: SheetData }
type SortDirection = "asc" | "desc" | null
type SortState = { columnIndex: number; direction: SortDirection }

const Switch = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
      checked ? "bg-primary" : "bg-accent"
    } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-foreground shadow transition-transform ${
        checked ? "translate-x-5" : "translate-x-1"
      }`}
    />
  </button>
)

function splitNiches(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export default function RedditDatabasePage() {
  const [sheetData, setSheetData] = useState<SheetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)
  const [selectedNiche, setSelectedNiche] = useState("all")
  const [search, setSearch] = useState("")
  const [showMinReqs, setShowMinReqs] = useState(false)
  const [sortState, setSortState] = useState<SortState>({ columnIndex: -1, direction: null })
  const intervalRef = useRef<number | null>(null)

  const loadSheet = useCallback(async (resetFilters: boolean) => {
    setLoading(true)
    if (resetFilters) {
      setSelectedNiche("all")
      setSortState({ columnIndex: -1, direction: null })
      setSearch("")
    }
    setError(null)
    try {
      const response = await fetch("/api/reddit-database", { cache: "no-store" })
      if (!response.ok) {
        let message = "Failed to fetch sheet data."
        try {
          const payload = await response.json()
          if (typeof payload?.error === "string") message = payload.error
        } catch {}
        throw new Error(message)
      }
      const { mainSheet }: ApiResponse = await response.json()
      setSheetData(mainSheet)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "An unknown error occurred while fetching the sheet.")
      setSheetData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSheet(true)
  }, [loadSheet])

  useEffect(() => {
    if (isAutoRefreshing) {
      intervalRef.current = window.setInterval(() => loadSheet(false), 30000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [isAutoRefreshing, loadSheet])

  const nicheColumnIndex = useMemo(
    () => sheetData?.headers.findIndex((header) => header.trim().toLowerCase() === "niche") ?? -1,
    [sheetData],
  )

  const nicheOptions = useMemo(() => {
    if (!sheetData || nicheColumnIndex < 0) return []
    const values = new Set<string>()
    sheetData.rows.forEach((row) => splitNiches(row[nicheColumnIndex] || "").forEach((item) => values.add(item)))
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [sheetData, nicheColumnIndex])

  const filteredRows = useMemo(() => {
    if (!sheetData) return []
    let rows = sheetData.rows
    if (selectedNiche !== "all" && nicheColumnIndex >= 0) {
      rows = rows.filter((row) => splitNiches(row[nicheColumnIndex] || "").includes(selectedNiche))
    }
    if (search.trim()) {
      const query = search.toLowerCase()
      rows = rows.filter((row) => row.some((cell) => String(cell || "").toLowerCase().includes(query)))
    }
    return rows
  }, [sheetData, selectedNiche, nicheColumnIndex, search])

  const handleSort = (columnIndex: number) => {
    setSortState((previous) => {
      if (previous.columnIndex !== columnIndex) return { columnIndex, direction: "asc" }
      if (previous.direction === "asc") return { columnIndex, direction: "desc" }
      if (previous.direction === "desc") return { columnIndex: -1, direction: null }
      return { columnIndex, direction: "asc" }
    })
  }

  let renderHeaders = sheetData?.headers ?? []
  let renderRows = filteredRows
  if (sheetData && !showMinReqs) {
    const hidden = new Set(["Min Post Karma", "Min Comment Karma", "Min Total Karma", "Min Account Age"])
    const keepIndices = renderHeaders.map((header, index) => (hidden.has(header) ? -1 : index)).filter((index) => index >= 0)
    renderHeaders = renderHeaders.filter((_, index) => keepIndices.includes(index))
    renderRows = renderRows.map((row) => keepIndices.map((index) => row[index] ?? ""))
  }

  return (
    <div className={`min-h-screen bg-background p-4 md:p-6 ${s.bgPattern}`}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Subreddit Database</h1>
          <p className="text-sm text-muted-foreground">
            Browse and filter the consolidated subreddit table by niche and scraper metrics. The scraper completes a
            full pass, rests for 24 hours, then starts the next pass.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <WarningIcon className="mt-0.5 h-5 w-5" />
            <div>
              <p className="font-medium">Unable to load subreddit database</p>
              <p className="text-xs text-destructive/90">{error}</p>
            </div>
          </div>
        )}

        {loading && !sheetData && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Fetching data from Google Sheets…</p>
          </div>
        )}

        {sheetData && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex w-96 flex-col gap-1">
                  <label htmlFor="search" className="text-xs font-semibold text-muted-foreground">Search</label>
                  <input
                    id="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search subreddits..."
                    className={s.csvinput}
                  />
                </div>
                <div className="flex w-40 flex-col gap-1">
                  <label htmlFor="nicheFilter" className="text-xs font-semibold text-muted-foreground">Filter Niche</label>
                  <Select value={selectedNiche} onValueChange={setSelectedNiche}>
                    <SelectTrigger id="nicheFilter" className={s.csvinput}><SelectValue placeholder="All niches" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All niches</SelectItem>
                      {nicheOptions.map((niche) => <SelectItem key={niche} value={niche}>{niche}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="mb-1 inline-flex h-10 items-center gap-3 rounded-md border border-border bg-card pl-3 pr-2 shadow-sm">
                  <span className="text-xs font-medium text-muted-foreground">Auto-refresh</span>
                  <Switch checked={isAutoRefreshing} onChange={setIsAutoRefreshing} disabled={loading} />
                </div>
                <button
                  type="button"
                  aria-label="Refresh database"
                  onClick={() => loadSheet(false)}
                  disabled={loading}
                  className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshIcon className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-b border-border pb-2">
              <button
                type="button"
                onClick={() => setShowMinReqs((visible) => !visible)}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                {showMinReqs ? "Hide Min Reqs" : "Show Min Reqs"}
              </button>
              <SubmitSubredditModal>
                <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90">
                  Submit a Subreddit
                </button>
              </SubmitSubredditModal>
            </div>

            <div className="px-1 text-xs text-muted-foreground">
              Showing {filteredRows.length.toLocaleString()} of {sheetData.rows.length.toLocaleString()} subreddits •{" "}
              {renderHeaders.length.toLocaleString()} columns
            </div>
            <DatabaseTable headers={renderHeaders} rows={renderRows} sortState={sortState} onSort={handleSort} />
          </section>
        )}

        {!loading && !sheetData && !error && (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            No sheet data loaded. Check the environment variables and refresh.
          </div>
        )}
      </div>
    </div>
  )
}
