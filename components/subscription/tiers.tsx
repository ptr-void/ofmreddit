"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, CheckCircle2, Copy, Loader2, X } from "lucide-react"

const PAYMENT_STORAGE_KEY = "activeCryptoPayment"

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
  embedded?: boolean
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
  embedded = false,
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
  const [paymentTimeLeft, setPaymentTimeLeft] = useState(0)

  useEffect(() => setCurrentTierId(currentTierIdProp), [currentTierIdProp])

  useEffect(() => {
    if (!open) return
    try {
      const saved = JSON.parse(localStorage.getItem(PAYMENT_STORAGE_KEY) || "null") as Payment | null
      if (saved?.id && new Date(saved.expiresAt).getTime() > Date.now() && ["pending", "confirming"].includes(saved.status)) {
        setPayment(saved)
      }
    } catch {
      localStorage.removeItem(PAYMENT_STORAGE_KEY)
    }
  }, [open])

  useEffect(() => {
    if (!payment || !["pending", "confirming"].includes(payment.status)) return
    const update = () => setPaymentTimeLeft(Math.max(0, new Date(payment.expiresAt).getTime() - Date.now()))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [payment])

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
      if (["pending", "confirming"].includes(updated.status)) {
        localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(updated))
      } else {
        localStorage.removeItem(PAYMENT_STORAGE_KEY)
      }
      window.dispatchEvent(new CustomEvent("crypto-payment-updated", { detail: updated }))
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
      localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(data.payment))
      window.dispatchEvent(new CustomEvent("crypto-payment-updated", { detail: data.payment }))
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

  if ((!embedded && !open) || typeof document === "undefined") return null

  const panel = (
      <div className={`relative w-full max-w-5xl overflow-y-auto rounded-2xl border border-border/50 bg-card shadow-2xl ${embedded ? "" : "max-h-[92vh] mx-4"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-card px-5 py-4">
          <div className="flex items-center gap-3">
            {payment && payment.status !== "paid" && (
              <button aria-label="Back to plans" onClick={() => { setPayment(null); setError("") }} className="rounded-full p-2 hover:bg-accent">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="text-xl font-bold text-foreground">{payment ? "Crypto Payment" : "Choose Your Plan"}</div>
          </div>
          {!embedded && <button aria-label="Close" onClick={onClose} className="cursor-pointer rounded-full p-2 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>}
        </div>

        <div className="px-5 pb-8 pt-6">
          {error && <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading plans…</div>}

          {!loading && payment && (
            <div className="mx-auto max-w-2xl space-y-5">
              {payment.status === "paid" ? (
                <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-8 text-center">
                  <CheckCircle2 className="mx-auto mb-4 size-12 text-green-500" />
                  <h3 className="text-2xl font-bold">Payment confirmed</h3>
                  <p className="mt-2 text-muted-foreground">{payment.tierName} is active for {payment.durationDays} days.</p>
                  <button onClick={() => embedded ? setPayment(null) : onClose()} className="mt-6 cursor-pointer rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Continue</button>
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
                  <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-bold text-white">
                    <Loader2 className="size-4 animate-spin" />
                    Waiting for payment confirmation · {Math.floor(Math.ceil(paymentTimeLeft / 1000) / 60)}:{String(Math.ceil(paymentTimeLeft / 1000) % 60).padStart(2, "0")}
                  </div>
                  <p className="text-center text-xs text-muted-foreground">Payment is checked automatically every 15 seconds. You can leave this page and reopen it from the floating timer.</p>
                </>
              )}
            </div>
          )}

          {!loading && !payment && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {tiers.map((tier, index) => {
                const isCurrent = Number(currentTierId || 0) === Number(tier.id)
                const numericPrice = tier.price == null || tier.price === "" ? null : Number(tier.price)
                const isFree = numericPrice === null || numericPrice === 0
                const duration = Math.max(1, Number(tier.duration_days || 30))
                const period = Math.max(1, Number(tier.usage_period_days || 7))
                const scraperLimit = Number(tier.weekly_scraper_limit)
                const termScrapes = isFree || scraperLimit < 0 ? scraperLimit : scraperLimit * Math.ceil(duration / period)
                return (
                  <div key={tier.id} className={`relative overflow-hidden rounded-2xl border transition-all hover:scale-[1.01] ${isCurrent ? "border-green-500 ring-2 ring-green-400/50" : "border-border/50"}`}>
                    <div className={`flex h-24 items-end bg-gradient-to-br ${headerGrad[index % headerGrad.length]} p-4`}>
                      <div className="text-xl font-bold text-white">{tier.name}</div>
                    </div>
                    <div className="space-y-4 bg-card p-5">
                      <div>
                        <div className="text-2xl font-bold">{isFree ? "$0.00" : `${numericPrice!.toFixed(2)} USDT`}</div>
                        <div className="text-xs text-muted-foreground">{isFree ? "Ongoing free access" : `${duration} days`}</div>
                      </div>
                      <ul className="space-y-2 text-xs">
                        <li className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{isFree ? `SPA analyses / rolling ${period} days` : `SPA analyses / ${duration}-day plan`}</span><strong className="shrink-0">{fmt(termScrapes)}</strong></li>
                        {!isFree && scraperLimit > 0 && <li className="text-[11px] text-muted-foreground">{scraperLimit} per {period} days × {Math.ceil(duration / period)} periods</li>}
                        <li className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Database lookups / rolling {period} days</span><strong className="shrink-0">{fmt(tier.weekly_database_limit)}</strong></li>
                        <li className="flex items-center justify-between gap-2"><span className="whitespace-nowrap text-muted-foreground">Daily Min Reqs</span><strong className="shrink-0">{fmt(tier.daily_subreddit_checker_limit)}</strong></li>
                      </ul>
                      <button
                        className={`w-full rounded-xl px-4 py-3 text-sm font-bold transition-opacity ${isCurrent || isFree ? "cursor-not-allowed bg-muted text-muted-foreground" : "cursor-pointer bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-90 disabled:cursor-pointer disabled:opacity-70"}`}
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
  )

  if (embedded) return <section className="mx-auto w-full max-w-5xl px-4 py-8">{panel}</section>

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {panel}
    </div>,
    document.body,
  )
}
