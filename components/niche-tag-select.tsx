"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const matches = options.filter(option => option.toLowerCase().includes(search.trim().toLowerCase()))
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
      <Popover open={open} onOpenChange={next => {
        setContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') || null)
        setOpen(next)
        setSearch("")
      }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            ref={triggerRef}
            type="button"
            variant="outline"
            disabled={disabled || loading || !!error}
            aria-required="true"
            onKeyDown={event => {
              if (!open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
                event.preventDefault()
                setContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') || null)
                setSearch(event.key)
                setOpen(true)
              }
            }}
            className="w-full justify-between bg-background font-normal"
          >
            <span className={selected.length ? "truncate" : "truncate text-muted-foreground"}>
              {loading ? "Loading niches..." : selected.length ? selected.join(", ") : "Select niche tags"}
            </span>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4 opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent container={container} align="start" className="w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-2"
          onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }}>
          <input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)}
            aria-label="Search niche tags" placeholder="Type to search niches..."
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain touch-pan-y" role="group" aria-label="Niche tags">
            {matches.length === 0 && <p role="status" className="p-2 text-sm text-muted-foreground">No matching niches.</p>}
            {matches.map((option) => {
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
          <p className="mt-2 text-xs text-muted-foreground">{selected.length}/8 selected</p>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
