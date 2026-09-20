"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, CheckCircle2, Copy, Loader2, X } from "lucide-react"

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

type Payment = {
  id: string
  tierId: number
  tierName: string
  durationDays: number
  amount: string
  coin: string
  network: string
  networkLabel: string
  address: string
  status: "pending" | "confirming" | "paid" | "expired" | "cancelled"
  txId: string | null
  expiresAt: string
  paidAt: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  currentTierId?: number | null
  onSelectTier?: (tierId: number) => void
}

const fmt = (value: number | string | null) => {
  if (value === null || value === "" || typeof value === "undefined") return "-"
  const number = Number(value)
  if (number < 0) return "Unlimited"
  return Number.isFinite(number) ? number.toString() : String(value)
}

export default function SubscriptionTiers({
  open,
  onClose,
  currentTierId: currentTierIdProp = null,
  onSelectTier,
}: Props) {
  const [tiers, setTiers] = useState<ApiTier[]>([])
  const [loading, setLoading] = useState(false)
  const [currentTierId, setCurrentTierId] = useState<number | null>(currentTierIdProp)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [startingTierId, setStartingTierId] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState("")

  useEffect(() => setCurrentTierId(currentTierIdProp), [currentTierIdProp])

  useEffect(() => {
    if (!open) return
    const token = localStorage.getItem("token")
    if (!token) return
    let alive = true
    setLoading(true)
    setError("")

    Promise.all([
      fetch("/api/subscriptions/tiers", { cache: "no-store" }).then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to load tiers")
        return Array.isArray(data.tiers) ? data.tiers as ApiTier[] : []
      }),
      fetch("/api/subscriptions/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }).then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to load subscription")
        return data.subscription?.tier_id == null ? null : Number(data.subscription.tier_id)
      }),
    ])
      .then(([tierRows, activeTier]) => {
        if (!alive) return
        setTiers(tierRows)
        setCurrentTierId(activeTier)
      })
      .catch((reason) => { if (alive) setError(reason.message) })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [open])

  const checkPayment = useCallback(async () => {
    if (!payment || !["pending", "confirming"].includes(payment.status)) return
    const token = localStorage.getItem("token")
    if (!token) return
    setPaymentBusy(true)
    try {
      const response = await fetch(`/api/payments/binance?id=${encodeURIComponent(payment.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Payment check failed")
      const updated = data.payment as Payment
      setPayment(updated)
      setError("")
      if (updated.status === "paid") {
        setCurrentTierId(updated.tierId)
        onSelectTier?.(updated.tierId)
      }
    } catch (reason: any) {
      setError(reason.message)
    } finally {
      setPaymentBusy(false)
    }
  }, [payment, onSelectTier])

  useEffect(() => {
    if (!open || !payment || !["pending", "confirming"].includes(payment.status)) return
    const timer = window.setInterval(checkPayment, 15_000)
    return () => window.clearInterval(timer)
  }, [open, payment, checkPayment])

  const startPayment = async (tierId: number) => {
    const token = localStorage.getItem("token")
    if (!token) {
      setError("Sign in to choose a paid plan")
      return
    }
    setStartingTierId(tierId)
    setPaymentBusy(true)
    setError("")
    try {
      const response = await fetch("/api/payments/binance", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tierId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Payment request failed")
      setPayment(data.payment)
    } catch (reason: any) {
      setError(reason.message)
    } finally {
      setPaymentBusy(false)
      setStartingTierId(null)
    }
  }

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied(""), 1500)
  }

  const headerGrad = useMemo(
    () => [
      "from-pink-500 via-rose-500 to-orange-400",
      "from-cyan-500 via-sky-500 to-blue-500",
      "from-emerald-500 via-teal-500 to-green-500",
      "from-violet-500 via-purple-500 to-fuchsia-500",
    ],
    [],
  )

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-border/50 bg-card shadow-2xl mx-4">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-card px-6 py-5">
          <div className="flex items-center gap-3">
            {payment && payment.status !== "paid" && (
              <button aria-label="Back to plans" onClick={() => { setPayment(null); setError("") }} className="rounded-full p-2 hover:bg-accent">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="text-2xl font-bold text-foreground">{payment ? "Crypto Payment" : "Choose Your Plan"}</div>
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-full p-2 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pb-10 pt-8">
          {error && <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading plans…</div>}

          {!loading && payment && (
            <div className="mx-auto max-w-2xl space-y-5">
              {payment.status === "paid" ? (
                <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-8 text-center">
                  <CheckCircle2 className="mx-auto mb-4 size-12 text-green-500" />
                  <h3 className="text-2xl font-bold">Payment confirmed</h3>
                  <p className="mt-2 text-muted-foreground">{payment.tierName} is active for {payment.durationDays} days.</p>
                  <button onClick={onClose} className="mt-6 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Continue</button>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                    Send the exact amount using <strong>{payment.networkLabel}</strong>. A different coin, network, or amount will not be matched automatically.
                  </div>
                  <div className="space-y-4 rounded-2xl border border-border p-6">
                    <div>
                      <div className="text-sm text-muted-foreground">Plan</div>
                      <div className="text-xl font-bold">{payment.tierName} · {payment.durationDays} days</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Exact amount</div>
                      <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
                        <span className="break-all font-mono text-lg font-bold">{payment.amount} {payment.coin}</span>
                        <button onClick={() => copy("amount", payment.amount)} className="shrink-0 rounded-md p-2 hover:bg-background" aria-label="Copy exact amount"><Copy className="size-4" /></button>
                      </div>
                      {copied === "amount" && <p className="mt-1 text-xs text-green-500">Amount copied</p>}
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Deposit address · {payment.networkLabel}</div>
                      <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
                        <span className="break-all font-mono text-sm">{payment.address}</span>
                        <button onClick={() => copy("address", payment.address)} className="shrink-0 rounded-md p-2 hover:bg-background" aria-label="Copy deposit address"><Copy className="size-4" /></button>
                      </div>
                      {copied === "address" && <p className="mt-1 text-xs text-green-500">Address copied</p>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Request expires {new Date(payment.expiresAt).toLocaleString()}. Status: <span className="font-semibold capitalize text-foreground">{payment.status}</span>
                    </div>
                  </div>
                  <button
                    onClick={checkPayment}
                    disabled={paymentBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-bold text-white disabled:opacity-60"
                  >
                    {paymentBusy && <Loader2 className="size-4 animate-spin" />}
                    I’ve paid — check payment
                  </button>
                  <p className="text-center text-xs text-muted-foreground">This page checks automatically every 15 seconds. Completed payments activate the plan without manual approval.</p>
                </>
              )}
            </div>
          )}

          {!loading && !payment && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {tiers.map((tier, index) => {
                const isCurrent = Number(currentTierId || 0) === Number(tier.id)
                const numericPrice = tier.price == null || tier.price === "" ? null : Number(tier.price)
                const isFree = numericPrice === null || numericPrice === 0
                const duration = Math.max(1, Number(tier.duration_days || 30))
                return (
                  <div key={tier.id} className={`relative overflow-hidden rounded-2xl border transition-all hover:scale-[1.01] ${isCurrent ? "border-green-500 ring-2 ring-green-400/50" : "border-border/50"}`}>
                    <div className={`flex h-28 items-end bg-gradient-to-br ${headerGrad[index % headerGrad.length]} p-5`}>
                      <div className="text-2xl font-bold text-white">{tier.name}</div>
                    </div>
                    <div className="space-y-5 bg-card p-6">
                      <div>
                        <div className="text-3xl font-bold">{isFree ? "$0.00" : `${numericPrice!.toFixed(2)} USDT`}</div>
                        <div className="text-sm text-muted-foreground">{isFree ? "Ongoing free access" : `${duration} days`}</div>
                      </div>
                      <ul className="space-y-2 text-sm">
                        <li className="flex justify-between"><span className="text-muted-foreground">Scraper / {Number(tier.usage_period_days || 7)} days</span><strong>{fmt(tier.weekly_scraper_limit)}</strong></li>
                        <li className="flex justify-between"><span className="text-muted-foreground">Planner / {Number(tier.usage_period_days || 7)} days</span><strong>{fmt(tier.weekly_planner_limit)}</strong></li>
                        <li className="flex justify-between"><span className="text-muted-foreground">Captions / {Number(tier.usage_period_days || 7)} days</span><strong>{fmt(tier.weekly_caption_limit)}</strong></li>
                        <li className="flex justify-between"><span className="text-muted-foreground">Database / {Number(tier.usage_period_days || 7)} days</span><strong>{fmt(tier.weekly_database_limit)}</strong></li>
                        <li className="flex justify-between"><span className="text-muted-foreground">Daily Checker</span><strong>{fmt(tier.daily_subreddit_checker_limit)}</strong></li>
                        <li className="flex justify-between"><span className="text-muted-foreground">Saved Usernames</span><strong>{fmt(tier.saved_username_limit)}</strong></li>
                        <li className="flex justify-between"><span className="text-muted-foreground">Saved Profiles</span><strong>{fmt(tier.saved_profile_limit)}</strong></li>
                      </ul>
                      <button
                        className={`w-full rounded-xl px-4 py-3 text-sm font-bold transition-opacity ${isCurrent || isFree ? "cursor-not-allowed bg-muted text-muted-foreground" : "cursor-pointer bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-70"}`}
                        disabled={isCurrent || isFree || paymentBusy}
                        onClick={() => startPayment(Number(tier.id))}
                      >
                        {startingTierId === Number(tier.id) ? (
                          <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Preparing payment…</span>
                        ) : isCurrent ? "Current Plan" : isFree ? "Free Plan" : "Pay with USDT"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!loading && !payment && tiers.length === 0 && <div className="text-sm text-muted-foreground">No tiers available.</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
