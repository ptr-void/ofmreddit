"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshIcon, WarningIcon } from "@/components/reddit-database/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select2"
import CreatorProfile, { type CreatorProfileValues } from "@/components/reddit-database/creator-profile"
import SavedProfiles from "@/components/reddit-database/saved-profile"
import DatabaseTable from "@/components/reddit-database/database-table"
import SubscriptionTiers from "@/components/subscription/tiers"
import SubmitSubredditModal from "@/components/reddit-database/submit-subreddit-modal"
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
    className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
      checked ? "bg-primary" : "bg-accent"
    } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-foreground shadow transition-transform ${
        checked ? "translate-x-5" : "translate-x-1"
      }`}
    />
  </button>
)

const Tooltip: React.FC<{ text: React.ReactNode; children: React.ReactNode }> = ({ text, children }) => (
  <div className="relative inline-flex items-center group">
    {children}
    <div className="pointer-events-none absolute top-full left-0 mt-2 w-96 bg-card text-xs text-left rounded py-3 px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-border shadow-lg z-20">
      {text}
    </div>
  </div>
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
  
  const [currentView, setCurrentView] = useState<"database" | "creator" | "saved">("database")

  const [normalizedProfile, setNormalizedProfile] = useState<any | null>(null)
  const [currentProfile, setCurrentProfile] = useState<CreatorProfileValues | null>(null)
  const [cachedProfile, setCachedProfile] = useState<CreatorProfileValues | null>(null)
  const [showTiers, setShowTiers] = useState(false)
  const [showMinReqs, setShowMinReqs] = useState(false)

  const nicheColumnIndexRef = useRef<number>(-1)
  const intervalRef = useRef<number | null>(null)
  const subredditNicheMapRef = useRef<Map<string, string[]>>(new Map())

  useEffect(() => {
    const snap = loadCreatorProfile()
    if (snap) {
      const { ts, ...rest } = snap as any
      setCachedProfile(rest as CreatorProfileValues)
    }
  }, [])

  const recomputeNicheOptions = (data: SheetData | null, tags: SheetData | null) => {
    if (!tags || !data) {
      setNicheOptions([])
      return
    }

    const headers = tags.headers.map(h => h.trim().toLowerCase())
    const subIdx = headers.indexOf("subreddit name")
    
    if (subIdx === -1) return

    const newMap = new Map<string, string[]>()
    const allNiches = new Set<string>()

    tags.rows.forEach(row => {
      const subName = (row[subIdx] || "").trim()
      if (!subName) return

      const rowNiches: string[] = []
      row.forEach((cell, idx) => {
        if (idx === subIdx) return
        if (!cell) return
        
        const parts = cell.split(",").map(p => p.trim().toLowerCase()).filter(Boolean)
        parts.forEach(p => {
          rowNiches.push(p)
          allNiches.add(p)
        })
      })
      newMap.set(subName, Array.from(new Set(rowNiches)))
    })

    subredditNicheMapRef.current = newMap
    setNicheOptions(Array.from(allNiches).sort((a, b) => a.localeCompare(b)))

    const mainHeaders = data.headers.map(h => h.trim().toLowerCase())
    nicheColumnIndexRef.current = mainHeaders.indexOf("subreddit")
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
      const res = await fetch("/api/reddit-database", { cache: "no-store" })
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
      recomputeNicheOptions(mainSheet, tagSheet)
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
    
    const subColIdx = nicheColumnIndexRef.current
    
    if (selectedNiche !== "all" && subColIdx !== -1) {
      rows = rows.filter((row) => {
        const subName = (row[subColIdx] || "").trim()
        const subNiches = subredditNicheMapRef.current.get(subName) || []
        return subNiches.includes(selectedNiche.toLowerCase())
      })
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

  const handleApplyProfile = async (profile: CreatorProfileValues) => {
    if (!rawSheetData || !tagSheetData) {
      setCurrentView("database")
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
      recomputeNicheOptions(filteredData, tagSheetData)
      setSelectedNiche("all")
      setSearch("")
      setSortState({ columnIndex: -1, direction: null })
      setCurrentView("database")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to apply creator profile."
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleEditSavedProfile = (profile: CreatorProfileValues) => {
    setCachedProfile(profile)
    setCurrentView("creator")
  }

  const titleText = "Subreddit Database"

  return (
    <div className={`min-h-screen bg-background p-4 md:p-6 ${s.bgPattern}`}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleText}</h1>
            {/* Wrap in a div instead of a p tag to allow valid nesting of the Tooltip component */}
            <div className="text-sm text-muted-foreground">
              <span>
                Browse and filter curated subreddits based on niche, tags, and creator profile preferences. 
                Use the Creator Profile button beside the auto refresh button to narrow results to only the subreddits that match your selected tags.
                The analytics scraper completes a full pass, rests for 24 hours, then starts the next pass.
              </span>

              <Tooltip
                text={
                  <div className="space-y-2 text-foreground">
                    <div>
                      <p className="font-medium">Minimum Post Karma</p>
                      <p>The minimum required post karma to publish in the subreddit.</p>
                    </div>

                    <div>
                      <p className="font-medium">Minimum Comment Karma</p>
                      <p>The minimum required comment karma to participate.</p>
                    </div>

                    <div>
                      <p className="font-medium">Minimum Account Age (days)</p>
                      <p>The required account age before a user can post.</p>
                    </div>

                    <div>
                      <p className="font-medium">Bot Bouncer</p>
                      <p>Detects if moderation bots like BotBouncer or SafestBot are active in the subreddit mod team.</p>
                    </div>

                    <div>
                      <p className="font-medium">CTA Captions</p>
                      <p>Indicates whether call-to-action / question captions (e.g. '?', 'would', 'how', 'what', 'do', 'or') are permitted, verified by checking live surviving posts older than 1–2 hours.</p>
                    </div>
                  </div>
                }
              >
                <span
                  aria-label="Database info"
                  className="mt-1 ml-4 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs text-foreground shadow-sm transition hover:bg-accent cursor-default"
                >
                  ?
                </span>
              </Tooltip>
            </div>
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

        {sheetData && (
          currentView === "creator" ? (
            <section className="flex flex-1 flex-col gap-4">
              <CreatorProfile
                onBack={() => setCurrentView("database")}
                onApply={handleApplyProfile}
                onShowTiers={() => setShowTiers(true)}
                initialProfile={cachedProfile}
                saving={loading}
              />
            </section>
          ) : currentView === "saved" ? (
            <section className="flex flex-1 flex-col gap-4">
              <SavedProfiles
                onBack={() => setCurrentView("database")}
                onEdit={handleEditSavedProfile}
                onApply={handleApplyProfile}
              />
            </section>
          ) : (
            <section className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex flex-col gap-1 w-96">
                    <label htmlFor="search" className="text-xs font-semibold text-muted-foreground">
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
                    <label htmlFor="nicheFilter" className="text-xs font-semibold text-muted-foreground">
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

                <div className="flex items-end gap-3">
                  <div className="mb-1 inline-flex h-10 items-center gap-3 rounded-md border border-border bg-card pl-3 pr-2 shadow-sm">
                    <span className="text-xs font-medium text-muted-foreground">Auto-refresh</span>
                    <Switch checked={isAutoRefreshing} onChange={(v) => setIsAutoRefreshing(v)} disabled={loading} />
                  </div>

                  <button
                    type="button"
                    onClick={handleRefreshClick}
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
                  onClick={() => setShowMinReqs(!showMinReqs)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition"
                >
                  {showMinReqs ? "Hide Min Reqs" : "Show Min Reqs"}
                </button>
                <SubmitSubredditModal>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition"
                  >
                    Submit a Subreddit
                  </button>
                </SubmitSubredditModal>
              </div>

              <div className="px-1 text-xs text-muted-foreground">
                {(() => {
                  const totalRows = rawSheetData?.rows.length ?? sheetData.rows.length
                  return (
                    <>
                      Showing {filteredRows.length.toLocaleString()} of {totalRows.toLocaleString()} subreddits •{" "}
                      {sheetData.headers.length.toLocaleString()} columns
                    </>
                  )
                })()}
              </div>

              {(() => {
                let renderHeaders = sheetData.headers
                let renderRows = filteredRows

                if (!showMinReqs) {
                  const hideCols = new Set(["Min Post Karma", "Min Comment Karma", "Min Total Karma", "Min Account Age"])
                  const keepIndices = renderHeaders
                    .map((h, i) => hideCols.has(h) ? -1 : i)
                    .filter(i => i !== -1)

                  renderHeaders = renderHeaders.filter((_, i) => keepIndices.includes(i))
                  renderRows = renderRows.map(row => row.filter((_, i) => keepIndices.includes(i)))
                }

                return (
                  <DatabaseTable
                    headers={renderHeaders}
                    rows={renderRows}
                    sortState={sortState}
                    onSort={handleSort}
                    subredditNicheMap={subredditNicheMapRef.current}
                  />
                )
              })()}
            </section>
          )
        )}

        <SubscriptionTiers 
          open={showTiers} 
          onClose={() => setShowTiers(false)} 
        />

        {!loading && !sheetData && !error && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No sheet data loaded. Check your environment variables and refresh.
          </div>
        )}
      </div>
    </div>
  )
}
