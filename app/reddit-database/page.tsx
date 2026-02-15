// app/reddit-database/page.tsx
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshIcon, WarningIcon } from "@/components/reddit-database/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select2"
import CreatorProfile, { type CreatorProfileValues } from "@/components/reddit-database/creator-profile"
import DatabaseTable from "@/components/reddit-database/database-table"
import AnalysisTable from "@/components/reddit-database/analysis-table"
import { saveCreatorProfile, loadCreatorProfile } from "@/lib/session-cache/creator-profile-cache"
import s from "@/styles/scraper.module.css"

type SheetData = {
  title: string
  headers: string[]
  rows: string[][]
}

type ApiResponse = {
  mainSheet: SheetData
  tagSheet: SheetData
}

const Switch = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    disabled={disabled}
    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
      checked ? "bg-primary" : "bg-foreground"
    } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
  >
    <span
      className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
        checked ? "translate-x-6" : "translate-x-1"
      }`}
    />
  </button>
)

type SortDirection = "asc" | "desc" | null

type SortState = {
  columnIndex: number
  direction: SortDirection
}

export default function RedditDatabasePage() {
  const [rawSheetData, setRawSheetData] = useState<SheetData | null>(null)
  const [sheetData, setSheetData] = useState<SheetData | null>(null)
  const [tagSheetData, setTagSheetData] = useState<SheetData | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)
  const [nicheOptions, setNicheOptions] = useState<string[]>([])
  const [selectedNiche, setSelectedNiche] = useState<string>("all")
  const [search, setSearch] = useState<string>("")
  const [sortState, setSortState] = useState<SortState>({ columnIndex: -1, direction: null })
  const [showCreatorProfile, setShowCreatorProfile] = useState(false)
  const [normalizedProfile, setNormalizedProfile] = useState<any | null>(null)
  const [currentProfile, setCurrentProfile] = useState<CreatorProfileValues | null>(null)
  const [cachedProfile, setCachedProfile] = useState<CreatorProfileValues | null>(null)
  const [activeTab, setActiveTab] = useState<"database" | "analysis">("database")

  const nicheColumnIndexRef = useRef<number>(-1)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    const snap = loadCreatorProfile()
    if (snap) {
      const { ts, ...rest } = snap as any
      setCachedProfile(rest as CreatorProfileValues)
    }
  }, [])

  const recomputeNicheOptions = (data: SheetData | null) => {
    if (!data) {
      setNicheOptions([])
      nicheColumnIndexRef.current = -1
      return
    }
    const nicheIndex = data.headers.findIndex((h) => h.trim().toLowerCase() === "niche")
    nicheColumnIndexRef.current = nicheIndex
    if (nicheIndex !== -1) {
      const uniques = Array.from(
        new Set(data.rows.map((row) => row[nicheIndex]).filter((v): v is string => Boolean(v && v.trim().length > 0))),
      ).sort((a, b) => a.localeCompare(b))
      setNicheOptions(uniques)
    } else {
      setNicheOptions([])
    }
  }

  const loadSheet = useCallback(async (resetFilters: boolean) => {
    setLoading(true)
    if (resetFilters) {
      setSelectedNiche("all")
      setSortState({ columnIndex: -1, direction: null })
      setSearch("")
      setNormalizedProfile(null)
      setCurrentProfile(null)
    }
    setError(null)
    try {
      const res = await fetch("/api/reddit-database")
      if (!res.ok) {
        let msg = "Failed to fetch sheet data."
        try {
          const errJson = await res.json()
          if (errJson && typeof errJson.error === "string") {
            msg = errJson.error
          }
        } catch {}
        throw new Error(msg)
      }

      const { mainSheet, tagSheet }: ApiResponse = await res.json()

      setRawSheetData(mainSheet)
      setSheetData(mainSheet)
      setTagSheetData(tagSheet)
      recomputeNicheOptions(mainSheet)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred while fetching the sheet."
      setError(msg)
      setRawSheetData(null)
      setSheetData(null)
      setTagSheetData(null)
      setNicheOptions([])
      nicheColumnIndexRef.current = -1
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSheet(true)
  }, [loadSheet])

  useEffect(() => {
    if (isAutoRefreshing) {
      intervalRef.current = window.setInterval(() => {
        loadSheet(false)
      }, 30000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isAutoRefreshing, loadSheet])

  const filteredRows = useMemo(() => {
    if (!sheetData) return []
    let rows = sheetData.rows
    if (selectedNiche !== "all" && nicheColumnIndexRef.current !== -1) {
      rows = rows.filter((row) => row[nicheColumnIndexRef.current] === selectedNiche)
    }
    if (search.trim().length > 0) {
      const q = search.toLowerCase()
      rows = rows.filter((row) => row.some((cell) => (cell || "").toString().toLowerCase().includes(q)))
    }
    return rows
  }, [sheetData, selectedNiche, search])

  const handleSort = (index: number) => {
    setSortState((prev) => {
      if (prev.columnIndex !== index) {
        return { columnIndex: index, direction: "asc" }
      }
      if (prev.direction === "asc") {
        return { columnIndex: index, direction: "desc" }
      }
      if (prev.direction === "desc") {
        return { columnIndex: -1, direction: null }
      }
      return { columnIndex: index, direction: "asc" }
    })
  }

  const handleRefreshClick = () => {
    loadSheet(false)
  }

  const handleSaveProfile = async (profile: CreatorProfileValues) => {
    if (!rawSheetData || !tagSheetData) {
      setShowCreatorProfile(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const normalized = null
      setNormalizedProfile(normalized)
      setCurrentProfile(profile)
      setCachedProfile(profile)
      saveCreatorProfile(profile)

      const tableRes = await fetch("/api/reddit-database/table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetData: rawSheetData,
          tagSheet: tagSheetData,
          profile,
          normalizedProfile: normalized,
        }),
      })

      if (!tableRes.ok) {
        let msg = "Failed to apply creator profile to table."
        try {
          const errJson = await tableRes.json()
          if (errJson && typeof errJson.error === "string") {
            msg = errJson.error
          }
        } catch {}
        throw new Error(msg)
      }

      const filteredData: SheetData = await tableRes.json()
      setSheetData(filteredData)
      recomputeNicheOptions(filteredData)
      setSelectedNiche("all")
      setSearch("")
      setSortState({ columnIndex: -1, direction: null })
      setShowCreatorProfile(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to apply creator profile."
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const titleText = "Subreddit Database"

  return (
    <div className={`min-h-screen bg-background p-4 md:p-6 ${s.bgPattern}`}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleText}</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-5xl">
              Browse and filter curated subreddits based on niche, tags, and creator profile preferences. 
              Use the Creator Profile button beside the auto refresh button to narrow results to only the subreddits that match your selected tags.
              Single subreddit data is being refreshed approximately every 4 days.
            </p>
          </div>
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
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Fetching data from Google Sheets…</p>
          </div>
        )}

        {sheetData &&
          (showCreatorProfile ? (
            <section className="flex flex-1 flex-col gap-4">
              <CreatorProfile
                onBack={() => setShowCreatorProfile(false)}
                onSave={handleSaveProfile}
                initialProfile={cachedProfile}
                saving={loading}
              />
            </section>
          ) : (
            <section className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex flex-col gap-1 w-96">
                    <label htmlFor="search" className="text-xs font-semibold text-foreground">
                      Search
                    </label>
                    <input
                      id="search"
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search subreddits..."
                      className={s.csvinput}
                    />
                  </div>

                  <div className="flex flex-col gap-1 w-40">
                    <label htmlFor="nicheFilter" className="text-xs font-semibold text-foreground">
                      Filter Niche
                    </label>
                    <Select value={selectedNiche} onValueChange={(v) => setSelectedNiche(v)}>
                      <SelectTrigger id="nicheFilter" className={s.csvinput}>
                        <SelectValue placeholder="All niches" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All niches</SelectItem>
                        {nicheOptions.map((niche) => (
                          <SelectItem key={niche} value={niche}>
                            {niche}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-end gap-4">
                  {!showCreatorProfile && (
                    <button
                      type="button"
                      onClick={() => setShowCreatorProfile(true)}
                      disabled={loading}
                      className="inline-flex items-center rounded-lg bg-accent border border-border mb-1 px-4 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Creator Profile
                    </button>
                  )}

                  <div className="flex flex-col gap-1 mb-1">
                    <span className="text-xs text-muted-foreground">Auto-refresh</span>
                    <Switch checked={isAutoRefreshing} onChange={(v) => setIsAutoRefreshing(v)} disabled={loading} />
                  </div>

                  <button
                    type="button"
                    onClick={handleRefreshClick}
                    disabled={loading}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshIcon className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  </button>
                </div>
              </div>

              <div className="flex gap-2 border-b border-border">
                <button
                  type="button"
                  onClick={() => setActiveTab("database")}
                  className={`px-3 py-2 text-xs font-medium transition ${
                    activeTab === "database"
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Subreddit Database
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("analysis")}
                  className={`px-3 py-2 text-xs font-medium transition ${
                    activeTab === "analysis"
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Subreddit Analysis
                </button>
              </div>

              <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
                {(() => {
                  const totalRows = rawSheetData?.rows.length ?? sheetData.rows.length
                  return (
                    <>
                      Showing {filteredRows.length.toLocaleString()} of {totalRows.toLocaleString()} rows •{" "}
                      {sheetData.headers.length.toLocaleString()} columns
                    </>
                  )
                })()}
              </div>

              {activeTab === "database" ? (
                <DatabaseTable headers={sheetData.headers} rows={filteredRows} sortState={sortState} onSort={handleSort} />
              ) : (
                <AnalysisTable sortState={sortState} onSort={handleSort} />
              )}
            </section>
          ))}

        {!loading && !sheetData && !error && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No sheet data loaded. Check your environment variables and refresh.
          </div>
        )}
      </div>
    </div>
  )
}
