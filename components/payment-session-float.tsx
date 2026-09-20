"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Clock3, Loader2 } from "lucide-react"

const STORAGE_KEY = "activeCryptoPayment"

type StoredPayment = {
  id: string
  tierName: string
  amount: string
  coin: string
  status: "pending" | "confirming" | "paid" | "expired" | "cancelled"
  expiresAt: string
}

function readPayment(): StoredPayment | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
    return value?.id ? value : null
  } catch {
    return null
  }
}

export function PaymentSessionFloat() {
  const router = useRouter()
  const [payment, setPayment] = useState<StoredPayment | null>(null)
  const [remaining, setRemaining] = useState(0)

  const refresh = useCallback(async () => {
    const saved = readPayment()
    if (!saved) return setPayment(null)
    const left = Math.max(0, new Date(saved.expiresAt).getTime() - Date.now())
    if (left === 0 || ["expired", "cancelled"].includes(saved.status)) {
      localStorage.removeItem(STORAGE_KEY)
      setPayment(null)
      return
    }
    setPayment(saved)
    setRemaining(left)
    const token = localStorage.getItem("token")
    if (!token || !["pending", "confirming"].includes(saved.status)) return
    try {
      const response = await fetch(`/api/payments/binance?id=${encodeURIComponent(saved.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok || !data.payment) return
      if (data.payment.status === "paid") {
        localStorage.removeItem(STORAGE_KEY)
        setPayment(null)
        window.dispatchEvent(new CustomEvent("crypto-payment-updated", { detail: data.payment }))
        return
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.payment))
      setPayment(data.payment)
    } catch {
      // Keep the session visible; the next interval retries without disrupting navigation.
    }
  }, [])

  useEffect(() => {
    refresh()
    const onUpdate = () => refresh()
    window.addEventListener("storage", onUpdate)
    window.addEventListener("crypto-payment-updated", onUpdate)
    const clock = window.setInterval(() => {
      const saved = readPayment()
      if (!saved) return setPayment(null)
      const left = Math.max(0, new Date(saved.expiresAt).getTime() - Date.now())
      setRemaining(left)
      if (left === 0) {
        localStorage.removeItem(STORAGE_KEY)
        setPayment(null)
      }
    }, 1000)
    const checker = window.setInterval(refresh, 15_000)
    return () => {
      window.removeEventListener("storage", onUpdate)
      window.removeEventListener("crypto-payment-updated", onUpdate)
      window.clearInterval(clock)
      window.clearInterval(checker)
    }
  }, [refresh])

  if (!payment) return null
  const totalSeconds = Math.ceil(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")

  return (
    <button
      type="button"
      onClick={() => router.push("/subscriptions")}
      className="fixed bottom-5 right-5 z-[9998] flex cursor-pointer items-center gap-3 rounded-2xl border border-cyan-400/40 bg-slate-950 px-4 py-3 text-left text-white shadow-2xl transition-transform hover:scale-[1.02]"
      aria-label="Open pending crypto payment"
    >
      <span className="relative flex size-10 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
        <Clock3 className="size-5" />
        <Loader2 className="absolute size-10 animate-spin text-cyan-400/60" />
      </span>
      <span>
        <span className="block text-sm font-bold">{payment.tierName} payment</span>
        <span className="block text-xs text-slate-300">{payment.amount} {payment.coin} · {minutes}:{seconds}</span>
      </span>
    </button>
  )
}
