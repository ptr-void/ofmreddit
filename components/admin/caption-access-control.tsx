"use client"

import { useEffect, useState } from "react"

export function CaptionAccessControl() {
  const [state, setState] = useState<{ enabled: boolean; configured: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  async function request(method = "GET", enabled?: boolean) {
    const token = localStorage.getItem("token")
    const response = await fetch("/api/admin/caption-access", {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(method === "PUT" ? { body: JSON.stringify({ enabled }) } : {}),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Failed to update caption access.")
    setState(data)
  }
  useEffect(() => { request().catch(error => setError(error.message)) }, [])
  async function toggle() {
    if (!state || saving) return
    setSaving(true)
    setError("")
    try { await request("PUT", !state.enabled) }
    catch (error: any) { setError(error.message) }
    finally { setSaving(false) }
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div id="caption-access-label" className="text-base font-medium text-foreground">Caption Generator User Access</div>
          <p className="text-sm text-muted-foreground">Turn off to pause generation and image analysis for users. Admins can still test; their tests still use API credits.</p>
          {state && <p role="status" className="mt-2 text-sm">{state.enabled ? "On — available to users" : "Off — admins only"}</p>}
          {state?.configured === false && <p className="text-sm text-amber-700">Apply the caption-access database migration to enable this toggle.</p>}
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
        <button type="button" role="switch" aria-labelledby="caption-access-label" aria-checked={state?.enabled ?? false}
          disabled={!state?.configured || saving} onClick={toggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${state?.enabled ? "bg-primary" : "bg-foreground"} disabled:opacity-60`}>
          <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${state?.enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
    </div>
  )
}
