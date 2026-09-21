"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select2"
import s from "@/styles/scraper.module.css"

type User = { id: number; email: string; username?: string | null; is_admin: boolean }
type Subscription = { id: number; user_id: number; tier_id: number; tier_name?: string; starts_at: string | null; ends_at: string | null }
type Tier = { id: number; name: string }

export function UserSubscriptionTab() {
  const { toast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<number, boolean>>({})

  const [banner, setBanner] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const bannerTimerRef = useRef<number | null>(null)
  const showBanner = (text: string, kind: "ok" | "err" = "ok") => {
    setBanner({ text, kind })
    if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = window.setTimeout(() => setBanner(null), 2000)
  }
  useEffect(() => () => { if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current) }, [])

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) return
    Promise.all([
      fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/subscriptions", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/subscription-tiers", { headers: { Authorization: `Bearer ${token}` } })
    ])
      .then(async ([u, sRes, t]) => {
        if (!u.ok || !sRes.ok || !t.ok) throw new Error("Failed to load data")
        const uData = await u.json()
        const sData = await sRes.json()
        const tData = await t.json()
        setUsers(uData.users || [])
        setSubs(sData.subscriptions || [])
        setTiers((tData.tiers || []).map((r: any) => ({ id: r.id, name: r.name })))
      })
      .catch((e) => toast({ title: "Error", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false))
  }, [toast])

  const initial = useMemo(() => {
    const map: Record<number, number | null> = {}
    subs.forEach(s => {
      map[s.user_id] = s.tier_id ?? null
    })
    return map
  }, [subs])

  const [rows, setRows] = useState<Record<number, number | null>>({})
  useEffect(() => setRows(initial), [initial])

  const save = async (userId: number, tierId: number | null) => {
    const token = localStorage.getItem("token")
    if (!token) return
    setSaving(prev => ({ ...prev, [userId]: true }))
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, tierId })
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        const msg = e.error || "Failed to save subscription"
        toast({ title: "Error", description: msg, variant: "destructive", duration: 2000 })
        showBanner(msg, "err")
        return
      }
      const data = await res.json()
      if (data.subscription) {
        setSubs((current) => [
          ...current.filter((subscription) => subscription.user_id !== userId),
          data.subscription,
        ])
      }
      toast({ title: "Saved", description: "Tier updated", duration: 2000 })
      showBanner("Tier updated!", "ok")
    } finally {
      setSaving(prev => ({ ...prev, [userId]: false }))
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">User Subscription Tiers</h2>
      <p className="mb-3 text-sm text-muted-foreground">Paid plans update automatically after payment. Use this table only for manual tier overrides.</p>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-card/60">
              <tr>
                <th className="text-left p-3 whitespace-nowrap">User</th>
                <th className="text-left p-3 whitespace-nowrap">Username</th>
                <th className="text-left p-3 whitespace-nowrap">Current Tier</th>
                <th className="text-left p-3 whitespace-nowrap">Assign Tier</th>
                <th className="text-left p-3 w-32 whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const tierId = rows[u.id] ?? initial[u.id] ?? tiers.find((tier) => tier.name.toLowerCase() === "free")?.id ?? tiers[0]?.id ?? null
                const currentTierId = initial[u.id] ?? tiers.find((tier) => tier.name.toLowerCase() === "free")?.id ?? null
                const currentTier = tiers.find((tier) => tier.id === currentTierId)?.name || "Free"
                const isSaving = !!saving[u.id]
                return (
                  <tr key={u.id} className="border-t border-border/60">
                    <td className="p-3">
                      <div className="font-medium truncate max-w-[260px]">{u.email}</div>
                      {u.is_admin ? (
                        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">Admin</span>
                      ) : (
                        <span className="text-xs bg-muted text-foreground/70 px-2 py-0.5 rounded">User</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={u.username && u.username.trim() !== "" ? "truncate inline-block max-w-[220px]" : "text-muted-foreground/70 italic"}>
                        {u.username && u.username.trim() !== "" ? u.username : "None"}
                      </span>
                    </td>
                    <td className="p-3 font-medium">{currentTier}</td>
                    <td className="p-3 min-w-[200px]">
                      <Select
                        value={tierId != null ? String(tierId) : ""}
                        onValueChange={(v) => setRows(prev => ({ ...prev, [u.id]: v ? Number(v) : null }))}
                      >
                        <SelectTrigger className={s.csvinput}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {tiers.map(t => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3 min-w-[140px]">
                      <button
                        className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => save(u.id, tierId)}
                        disabled={isSaving || tierId == null || tierId === currentTierId}
                        aria-busy={isSaving}
                      >
                        {isSaving ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {banner && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-3 py-2 text-sm rounded-md shadow-lg
            ${banner.kind === "ok" ? "bg-foreground text-background" : "bg-rose-600 text-white"}`}
          role="status"
          aria-live="polite"
        >
          {banner.text}
        </div>
      )}
    </div>
  )
}
