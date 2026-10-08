"use client"

import { useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown } from "lucide-react"

export function SearchableNicheFilter({ options, value, onChange, className }: {
  options: string[]; value: string; onChange: (value: string) => void; className?: string
}) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const matches = options.filter(option => option.toLowerCase().includes(search.trim().toLowerCase()))
  return <Popover open={open} onOpenChange={next => { setOpen(next); setSearch("") }}>
    <PopoverTrigger asChild><button id="nicheFilter" type="button" className={`${className} flex items-center justify-between gap-2`}
      aria-label="Filter Niche" onKeyDown={event => {
        if (!open && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); setSearch(event.key); setOpen(true)
        }
      }}><span className="truncate">{value === "all" ? "All niches" : value}</span><ChevronDown className="size-4 shrink-0" /></button></PopoverTrigger>
    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-52 p-2"
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus() }}>
      <input ref={input} type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search filter niches"
        placeholder="Type to search niches..." className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
      <div role="group" aria-label="Filter niche options" className="max-h-64 overflow-y-auto overscroll-contain touch-pan-y">
        {["all", ...matches].map(option => <button type="button" key={option} aria-pressed={option === value}
          className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
          onClick={() => { onChange(option); setOpen(false) }}>{option === "all" ? "All niches" : option}</button>)}
        {matches.length === 0 && <p role="status" className="p-2 text-sm">No matching niches.</p>}
      </div>
    </PopoverContent>
  </Popover>
}
