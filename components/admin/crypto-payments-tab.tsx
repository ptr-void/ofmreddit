"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"

type PaymentRow = {
  id: string
  expected_amount: string
  coin: string
  network: string
  status: string
  tx_id: string | null
  created_at: string
  expires_at: string
  paid_at: string | null
  tier_name: string
  duration_days: number
  email: string
  username: string | null
  telegram_username: string | null
}

export function CryptoPaymentsTab() {
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const token = localStorage.getItem("token")
    if (!token) return
    setLoading(true)
    try {
      const response = await fetch("/api/admin/crypto-payments", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load payments")
      setRows(Array.isArray(data.payments) ? data.payments : [])
      setError("")
    } catch (reason: any) {
      setError(reason.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const statusClass = (status: string) => status === "paid"
    ? "bg-green-500/15 text-green-500"
    : status === "pending" || status === "confirming"
      ? "bg-amber-500/15 text-amber-500"
      : "bg-muted text-muted-foreground"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Crypto Payment Attempts</h2>
          <p className="text-sm text-muted-foreground">Opened, pending, expired, and successful payment sessions.</p>
        </div>
        <button onClick={load} disabled={loading} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:cursor-pointer disabled:opacity-60">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </button>
      </div>
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1050px] text-sm">
          <thead className="bg-muted/60 text-left">
            <tr><th className="p-3">User</th><th className="p-3">Tier</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Opened</th><th className="p-3">Expires / Paid</th><th className="p-3">Transaction</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="p-3"><div className="font-medium">{row.username || row.telegram_username || "Unnamed"}</div><div className="text-xs text-muted-foreground">{row.email}</div></td>
                <td className="p-3"><div className="font-medium">{row.tier_name}</div><div className="text-xs text-muted-foreground">{row.duration_days} days</div></td>
                <td className="p-3 font-mono">{row.expected_amount} {row.coin}<div className="text-xs text-muted-foreground">{row.network}</div></td>
                <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(row.status)}`}>{row.status}</span></td>
                <td className="p-3">{new Date(row.created_at).toLocaleString()}</td>
                <td className="p-3">{new Date(row.paid_at || row.expires_at).toLocaleString()}<div className="text-xs text-muted-foreground">{row.paid_at ? "Paid" : "Expires"}</div></td>
                <td className="max-w-48 break-all p-3 font-mono text-xs">{row.tx_id || "—"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No payment attempts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
