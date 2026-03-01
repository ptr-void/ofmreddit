"use client"
import { useEffect, useState, useRef } from "react"
import { useToast } from "@/hooks/use-toast"

type ApiTier = {
  id: number
  name: string
  price: number | string | null
  weekly_scraper_limit: number | string | null
  weekly_planner_limit: number | string | null
  weekly_caption_limit: number | string | null
  weekly_database_limit: number | string | null
  saved_username_limit: number | string | null
  saved_profile_limit: number | string | null
}

type UiTier = {
  id: number
  name: string
  priceStr: string
  limits: {
    weekly_scraper_limit: string
    weekly_planner_limit: string
    weekly_caption_limit: string
    weekly_database_limit: string
    saved_username_limit: string
    saved_profile_limit: string
  }
}

const LIMIT_KEYS = [
  "weekly_scraper_limit",
  "weekly_planner_limit",
  "weekly_caption_limit",
  "weekly_database_limit",
  "saved_username_limit",
  "saved_profile_limit",
] as const

const LABELS: Record<(typeof LIMIT_KEYS)[number], string> = {
  weekly_scraper_limit: "Weekly Scraper Limit",
  weekly_planner_limit: "Weekly Planner Limit",
  weekly_caption_limit: "Weekly Caption Limit",
  weekly_database_limit: "Weekly Database Limit",
  saved_username_limit: "Saved Username Limit",
  saved_profile_limit: "Saved Profile Limit",
}

export function SubscriptionTierTab() {
  const { toast } = useToast()
  const [tiers, setTiers] = useState<UiTier[]>([])
  const [loading, setLoading] = useState(true)
  const [showBanner, setShowBanner] = useState(false)
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
          limits: {
            weekly_scraper_limit:
              row.weekly_scraper_limit == null ? "" : String(row.weekly_scraper_limit),
            weekly_planner_limit:
              row.weekly_planner_limit == null ? "" : String(row.weekly_planner_limit),
            weekly_caption_limit:
              row.weekly_caption_limit == null ? "" : String(row.weekly_caption_limit),
            weekly_database_limit:
              row.weekly_database_limit == null ? "" : String(row.weekly_database_limit),
            saved_username_limit:
              row.saved_username_limit == null ? "" : String(row.saved_username_limit),
            saved_profile_limit:
              row.saved_profile_limit == null ? "" : String(row.saved_profile_limit),
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
      weekly_scraper_limit: tier.limits.weekly_scraper_limit === "" ? 0 : Number(tier.limits.weekly_scraper_limit),
      weekly_planner_limit: tier.limits.weekly_planner_limit === "" ? 0 : Number(tier.limits.weekly_planner_limit),
      weekly_caption_limit: tier.limits.weekly_caption_limit === "" ? 0 : Number(tier.limits.weekly_caption_limit),
      weekly_database_limit: tier.limits.weekly_database_limit === "" ? 0 : Number(tier.limits.weekly_database_limit),
      saved_username_limit: tier.limits.saved_username_limit === "" ? 0 : Number(tier.limits.saved_username_limit),
      saved_profile_limit: tier.limits.saved_profile_limit === "" ? 0 : Number(tier.limits.saved_profile_limit),
    }

    const res = await fetch("/api/admin/subscription-tiers", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tier: payload }),
    })

    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      toast({ title: "Error", description: e.error || "Failed to save tier", variant: "destructive", duration: 2000 })
      return
    }

    setShowBanner(true)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setShowBanner(false), 2000)
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Edit Subscription Tiers</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                placeholder="Price"
                value={tier.priceStr}
                onChange={(e) => updateTier(i, (t) => ({ ...t, priceStr: e.target.value }))}
              />
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
              className="mt-4 w-full rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90"
              onClick={() => saveTier(tiers[i])}
            >
              Save Tier
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
