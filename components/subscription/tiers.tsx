"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

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

type ApiSubscription = {
  id: number
  user_id: number
  tier_id: number
  tier_name: string
  starts_at: string
  ends_at: string | null
  cooldown: string | null
  user_email: string
}

type Props = {
  open: boolean
  onClose: () => void
  currentTierId?: number | null
  onSelectTier?: (tierId: number) => void
}

const fmt = (v: number | string | null) => {
  if (v === null || v === "" || typeof v === "undefined") return "-"
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return n.toString()
}

export default function SubscriptionTiers(props: Props) {
  const { open, onClose, currentTierId: currentTierIdProp = null, onSelectTier } = props
  const [tiers, setTiers] = useState<ApiTier[]>([])
  const [loading, setLoading] = useState(false)
  const [currentTierId, setCurrentTierId] = useState<number | null>(currentTierIdProp ?? null)

  useEffect(() => {
    if (typeof currentTierIdProp === "number" || currentTierIdProp === null) {
      setCurrentTierId(currentTierIdProp)
    }
  }, [currentTierIdProp])

  useEffect(() => {
    if (!open) return
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    if (!token) return
    let alive = true
    setLoading(true)

    const me = (() => {
      try { return JSON.parse(localStorage.getItem("user") || "null") } catch { return null }
    })()
    const myId = Number(me?.id ?? me?.userId ?? me?.user_id ?? 0)
    const myEmail = String(me?.email || "").toLowerCase()

    const fetchTiers = fetch("/api/admin/subscription-tiers", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async r => {
      if (!r.ok) throw new Error("failed to load tiers")
      const j = await r.json()
      return (Array.isArray(j?.tiers) ? j.tiers : []) as ApiTier[]
    })

    const fetchMine = fetch("/api/admin/subscriptions", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async r => {
      if (!r.ok) throw new Error("failed to load subscriptions")
      const j = await r.json()
      const list: ApiSubscription[] = Array.isArray(j?.subscriptions) ? j.subscriptions : []

      const mine = list.filter(s => {
        if (myId) return Number(s.user_id) === myId
        if (myEmail) return String(s.user_email || "").toLowerCase() === myEmail
        return false
      })

      const now = Date.now()
      const active = mine
        .filter(s => !s.ends_at || new Date(s.ends_at).getTime() > now)
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0]

      if (active) return active.tier_id

      const latest = mine
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0]

      return latest ? latest.tier_id : null
    })

    Promise.allSettled([fetchTiers, fetchMine])
      .then(res => {
        if (!alive) return
        const tiersResult = res[0].status === "fulfilled" ? res[0].value : []
        const tierIdResult = res[1].status === "fulfilled" ? res[1].value : null
        setTiers(tiersResult)
        if (typeof tierIdResult === "number" || tierIdResult === null) {
          setCurrentTierId(tierIdResult)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => { alive = false }
  }, [open])


  const headerGrad = useMemo(
    () => [
      "from-pink-500 via-rose-500 to-orange-400",
      "from-cyan-500 via-sky-500 to-blue-500",
      "from-emerald-500 via-teal-500 to-green-500",
      "from-violet-500 via-purple-500 to-fuchsia-500",
    ],
    []
  )

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-6xl mx-4 rounded-2xl border border-border/50 bg-card shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border/50">
          <div className="text-2xl font-bold text-foreground">Choose Your Plan</div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-accent transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pt-8 pb-10">
          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {tiers.map((t, i) => {
                const isCurrent = Number(currentTierId || 0) === Number(t.id)
                const price =
                  t.price === null || t.price === "" || Number(t.price) === 0
                    ? "$0.00/mo"
                    : `$${Number(t.price).toFixed(2)}/mo`
                return (
                  <div
                    key={t.id}
                    className={`relative overflow-hidden rounded-2xl border transition-all hover:scale-[1.02] ${isCurrent
                        ? "border-green-500 ring-2 ring-green-400/50 shadow-[0_0_12px_rgba(34,197,94,0.4)]"
                        : "border-border/50 hover:border-border"
                      }`}
                  >
                    <div
                      className={`h-32 w-full bg-gradient-to-br ${headerGrad[i % headerGrad.length]} flex items-end p-5`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="text-2xl font-bold text-white drop-shadow-lg">{t.name}</div>
                      </div>
                    </div>

                    <div className="p-6 bg-card space-y-5">
                      <div className="text-3xl font-bold text-foreground">{price}</div>
                      <ul className="space-y-3.5 text-sm">
                        <li className="flex items-center justify-between py-1">
                          <span className="text-muted-foreground">Weekly Scraper Limit</span>
                          <span className="font-bold text-foreground text-base">{fmt(t.weekly_scraper_limit)}</span>
                        </li>
                        <li className="flex items-center justify-between py-1">
                          <span className="text-muted-foreground">Weekly Planner Limit</span>
                          <span className="font-bold text-foreground text-base">{fmt(t.weekly_planner_limit)}</span>
                        </li>
                        <li className="flex items-center justify-between py-1">
                          <span className="text-muted-foreground">Weekly Caption Limit</span>
                          <span className="font-bold text-foreground text-base">{fmt(t.weekly_caption_limit)}</span>
                        </li>
                        <li className="flex items-center justify-between py-1">
                          <span className="text-muted-foreground">Weekly Database Limit</span>
                          <span className="font-bold text-foreground text-base">{fmt(t.weekly_database_limit)}</span>
                        </li>
                        <li className="flex items-center justify-between py-1">
                          <span className="text-muted-foreground">Saved Username Limit</span>
                          <span className="font-bold text-foreground text-base">{fmt(t.saved_username_limit)}</span>
                        </li>
                        <li className="flex items-center justify-between py-1">
                          <span className="text-muted-foreground">Saved Profile Limit</span>
                          <span className="font-bold text-foreground text-base">{fmt(t.saved_profile_limit)}</span>
                        </li>
                      </ul>

                      <button
                        className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold transition-all ${isCurrent
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 shadow-md hover:shadow-xl"
                          }`}
                        disabled={isCurrent}
                        onClick={() => onSelectTier?.(Number(t.id))}
                      >
                        {isCurrent ? "Selected" : "Choose Plan"}
                      </button>

                      {isCurrent && (
                        <div className="text-center text-sm font-semibold text-green-400 mt-4">
                          ✅ Current Plan
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!loading && tiers.length === 0 && (
            <div className="text-sm text-muted-foreground">No tiers available.</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
