"use client"
import { useEffect, useState, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select2"
import { Button } from "@/components/ui/button"
import s from "@/styles/scraper.module.css"
import a from "@/styles/admin.module.css"

type SiteControls = {
  show_sub: number
  default_cooldown: "0" | "10" | "30"
  subreddit_checker_limit: number
}

const COOLDOWN_CHOICES: Array<{ value: "0" | "10" | "30"; label: string }> = [
  { value: "0", label: "No Cooldown" },
  { value: "10", label: "10-Minute Cooldown" },
  { value: "30", label: "30-Minute Cooldown" },
]

export function SiteControlsTab() {
  const { toast } = useToast()
  const [data, setData] = useState<SiteControls | null>(null)
  const [localLimit, setLocalLimit] = useState<number | string>(5)
  const [saving, setSaving] = useState(false)
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
  const trigRef = useRef<HTMLButtonElement | null>(null)
  const [ddw, setDdw] = useState<number | null>(null)

  const load = async () => {
    const res = await fetch("/api/admin/site-controls", { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      toast({ title: "Error", description: "Failed to load site controls", variant: "destructive" })
      return
    }
    const j = await res.json()
    setData(j)
    if (j && j.subreddit_checker_limit !== undefined) {
      setLocalLimit(j.subreddit_checker_limit)
    }
  }

  useEffect(() => {
    if (token) load()
  }, [])

  useEffect(() => {
    const el = trigRef.current
    if (!el) return
    const cs = window.getComputedStyle(el)
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const maxLabel = COOLDOWN_CHOICES.reduce(
      (m, o) => (ctx.measureText(o.label).width > m ? ctx.measureText(o.label).width : m),
      0
    )
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    const caretReserve = 24
    setDdw(Math.ceil(maxLabel + padX + caretReserve))
  }, [])

  const save = async (patch: Partial<SiteControls>) => {
    if (!data) return
    const next = { ...data, ...patch }
    setData(next)
    setSaving(true)
    const res = await fetch("/api/admin/site-controls", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(next),
    })
    setSaving(false)
    if (!res.ok) {
      toast({ title: "Error", description: "Failed to save", variant: "destructive" })
      await load()
      return
    }
    toast({ title: "Saved", description: "Site controls updated" })
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
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-foreground"
      } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-base font-medium text-foreground">Show Subscription Tier Panel</div>
            <div className="text-sm text-muted-foreground">Toggle visibility of the subscription tiers upsell.</div>
          </div>
          <Switch
            checked={(data?.show_sub ?? 1) === 1}
            onChange={(v) => save({ show_sub: v ? 1 : 0 })}
            disabled={!data || saving}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-base font-medium text-foreground">Set Default Cooldown</div>
            <div className="text-sm text-muted-foreground">Applies the moment a user registers on the website.</div>
          </div>
          <div className="shrink-0">
            <Select
              value={data?.default_cooldown ?? "30"}
              onValueChange={(v) => save({ default_cooldown: v as "0" | "10" | "30" })}
            >
              <SelectTrigger
                ref={trigRef}
                className={s.csvinput}
                style={ddw ? { width: ddw } : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                className="min-w-[--radix-select-trigger-width]"
                style={ddw ? { width: ddw } : undefined}
              >
                {COOLDOWN_CHOICES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-base font-medium text-foreground">Subreddit Checker Daily Limit</div>
            <div className="text-sm text-muted-foreground">Number of times a user can use the checker per 24 hours.</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={localLimit}
              onChange={(e) => setLocalLimit(e.target.value === "" ? "" : Number(e.target.value))}
              className={s.csvinput}
              style={{ width: "80px", textAlign: "center" }}
              disabled={!data || saving}
            />
            <Button 
              size="sm" 
              onClick={() => save({ subreddit_checker_limit: Number(localLimit) })}
              disabled={!data || saving || Number(localLimit) === data?.subreddit_checker_limit || localLimit === ""}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
