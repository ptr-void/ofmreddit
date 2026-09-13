"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

function split(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
}

export function NicheTagSelect({ value, onChange, disabled, id }: Props) {
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const selected = useMemo(() => split(value), [value])
  const atLimit = selected.length >= 8

  useEffect(() => {
    let active = true
    fetch("/api/subreddits/niches")
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Failed to load niche presets")
        if (active) setOptions(Array.isArray(data.niches) ? data.niches : [])
      })
      .catch((reason) => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const toggle = (option: string, checked: boolean) => {
    const next = checked
      ? [...selected, option].filter((item, index, all) => all.indexOf(item) === index)
      : selected.filter((item) => item !== option)
    onChange(next.join(", "))
  }

  return (
    <div className="space-y-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled || loading || !!error}
            aria-required="true"
            className="w-full justify-between bg-background font-normal"
          >
            <span className={selected.length ? "truncate" : "truncate text-muted-foreground"}>
              {loading ? "Loading niches..." : selected.length ? selected.join(", ") : "Select niche tags"}
            </span>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4 opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
          <div className="max-h-64 space-y-1 overflow-y-auto" role="group" aria-label="Niche tags">
            {options.map((option) => {
              const checked = selected.includes(option)
              return (
                <label key={option} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={checked}
                    disabled={!checked && atLimit}
                    onCheckedChange={(state) => toggle(option, state === true)}
                  />
                  <span>{option}</span>
                </label>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
