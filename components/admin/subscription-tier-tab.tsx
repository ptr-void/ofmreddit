"use client"
import { useEffect, useState, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

type ApiTier = {
  id: number
  name: string
  price: number | string | null
  duration_days: number | string | null
  usage_period_days: number | string | null
  weekly_scraper_limit: number | string | null
  weekly_planner_limit: number | string | null
  weekly_caption_limit: number | string | null
  weekly_database_limit: number | string | null
  saved_username_limit: number | string | null
  saved_profile_limit: number | string | null
  daily_subreddit_checker_limit: number | string | null
}

type UiTier = {
  id: number
  name: string
  priceStr: string
  durationDays: string
  usagePeriodDays: string
  limits: {
    weekly_scraper_limit: string
    weekly_database_limit: string
    daily_subreddit_checker_limit: string
  }
}

const LIMIT_KEYS = [
  "weekly_scraper_limit",
  "weekly_database_limit",
  "daily_subreddit_checker_limit",
] as const

const LABELS: Record<(typeof LIMIT_KEYS)[number], string> = {
  weekly_scraper_limit: "SPA Limit / selected period",
  weekly_database_limit: "Database Limit / selected period",
  daily_subreddit_checker_limit: "Daily Minimum Reqs Scraper Limit",
}

export function SubscriptionTierTab() {
  const { toast } = useToast()
  const [tiers, setTiers] = useState<UiTier[]>([])
  const [loading, setLoading] = useState(true)
  const [showBanner, setShowBanner] = useState(false)
  const [savingTierId, setSavingTierId] = useState<number | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) return
    fetch("/api/admin/subscription-tiers", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load tiers")
        const data = await r.json()
        const rows: ApiTier[] = Array.isArray(data.tiers) ? data.tiers : []
        const mapped: UiTier[] = rows.map((row) => ({
          id: Number(row.id),
          name: String(row.name ?? ""),
          priceStr:
            row.price === null || row.price === undefined || row.price === ""
              ? ""
              : String(row.price),
          durationDays: row.duration_days == null ? "30" : String(row.duration_days),
          usagePeriodDays: row.usage_period_days == null ? "7" : String(row.usage_period_days),
          limits: {
            weekly_scraper_limit:
              row.weekly_scraper_limit == null ? "" : String(row.weekly_scraper_limit),
            weekly_database_limit:
              row.weekly_database_limit == null ? "" : String(row.weekly_database_limit),
            daily_subreddit_checker_limit:
              row.daily_subreddit_checker_limit == null ? "" : String(row.daily_subreddit_checker_limit),
          },
        }))
        setTiers(mapped)
      })
      .catch((e) => toast({ title: "Error", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false))
  }, [toast])

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  const updateTier = (idx: number, updater: (t: UiTier) => UiTier) => {
    setTiers((cur) => {
      const next = [...cur]
      next[idx] = updater({ ...next[idx] })
      return next
    })
  }

  const saveTier = async (tier: UiTier) => {
    const token = localStorage.getItem("token")
    if (!token) return

    const payload = {
      id: tier.id,
      name: tier.name,
      price: tier.priceStr === "" ? null : Number(tier.priceStr),
      duration_days: tier.durationDays === "" ? 30 : Number(tier.durationDays),
      usage_period_days: tier.usagePeriodDays === "" ? 7 : Number(tier.usagePeriodDays),
      weekly_scraper_limit: tier.limits.weekly_scraper_limit === "" ? 0 : Number(tier.limits.weekly_scraper_limit),
      weekly_database_limit: tier.limits.weekly_database_limit === "" ? 0 : Number(tier.limits.weekly_database_limit),
      daily_subreddit_checker_limit:
        tier.limits.daily_subreddit_checker_limit === ""
          ? 0
          : Number(tier.limits.daily_subreddit_checker_limit),
    }

    setSavingTierId(tier.id)
    try {
      const res = await fetch("/api/admin/subscription-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier: payload }),
      })

      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || "Failed to save tier")
      }

      setShowBanner(true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setShowBanner(false), 2000)
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive", duration: 2000 })
    } finally {
      setSavingTierId(null)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Edit Subscription Tiers</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Database limits reset over the selected rolling period. Paid SPA limits are displayed and enforced as a total for the plan: SPA limit × rounded-up number of periods in the plan. Use -1 for unlimited access and 0 to disable a feature.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
        {tiers.map((tier, i) => (
          <div key={tier.id} className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <input
                className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 font-semibold"
                value={tier.name}
                onChange={(e) => updateTier(i, (t) => ({ ...t, name: e.target.value }))}
              />
              <input
                type="text"
                inputMode="decimal"
                className="w-28 shrink-0 rounded-md border border-border bg-background px-3 py-2"
                placeholder="Price (USDT)"
                value={tier.priceStr}
                onChange={(e) => updateTier(i, (t) => ({ ...t, priceStr: e.target.value }))}
              />
            </div>

            <div className="mb-3 grid grid-cols-2 items-center gap-2">
              <label className="text-sm text-muted-foreground">Duration (days)</label>
              <input
                type="text"
                inputMode="numeric"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                value={tier.durationDays}
                onChange={(e) => updateTier(i, (t) => ({ ...t, durationDays: e.target.value }))}
              />
            </div>

            <div className="mb-3 grid grid-cols-2 items-center gap-2">
              <label className="text-sm text-muted-foreground">Usage limit period</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                value={tier.usagePeriodDays}
                onChange={(e) => updateTier(i, (t) => ({ ...t, usagePeriodDays: e.target.value }))}
              >
                <option value="7">Every 7 days</option>
                <option value="10">Every 10 days</option>
                <option value="30">Every 30 days</option>
              </select>
            </div>

            <div className="space-y-2">
              {LIMIT_KEYS.map((key) => (
                <div key={key} className="grid grid-cols-2 items-center gap-2">
                  <label className="text-sm text-muted-foreground">{LABELS[key]}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    placeholder="0"
                    value={tiers[i].limits[key]}
                    onChange={(e) =>
                      updateTier(i, (t) => ({
                        ...t,
                        limits: { ...t.limits, [key]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            <button
              className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground hover:opacity-90 disabled:cursor-pointer disabled:opacity-70"
              onClick={() => saveTier(tiers[i])}
              disabled={savingTierId !== null}
            >
              {savingTierId === tier.id && <Loader2 className="size-4 animate-spin" />}
              {savingTierId === tier.id ? "Saving…" : "Save Tier"}
            </button>
          </div>
        ))}
      </div>

      {tiers.length === 0 && <div className="text-sm text-muted-foreground">No tiers found.</div>}

      {showBanner && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-md bg-foreground text-background px-3 py-2 text-sm shadow-lg"
          role="status"
          aria-live="polite"
        >
          Subscription Tier updated!
        </div>
      )}
    </div>
  )
}
