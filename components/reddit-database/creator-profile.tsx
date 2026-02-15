"use client"

import { useEffect, useMemo, useState } from "react"

export type CreatorProfileValues = {
  ethnicity: string
  bodyType: string
  hairColor: string
  ageBracket: string
  boobsType: string
  distinctiveFeatures: string
  hardLimits: string
  specialties: string
  collabSolo: boolean
  collabBoyGirl: boolean
  collabGirlGirl: boolean
  ethnicityOther: string
  bodyTypeOther: string
  hairColorOther: string
  ageBracketOther: string
  include: {
    ethnicity: string[]
    bodyType: string[]
    age: string[]
    bodyPart: string[]
    boobSubCategory: string[]
    assSubCategory: string[]
    others: string[]
  }
}

type CreatorProfileProps = {
  onBack: () => void
  onSave: (profile: CreatorProfileValues) => void
  initialProfile?: CreatorProfileValues | null
  saving?: boolean
}

const OPTIONS = {
  ethnicity: ["black", "white", "asian", "latina", "aussie", "brown"],
  bodyType: ["skinny", "petite", "athletic", "thick", "fat/chubby"],
  age: ["under 25/teen", "over 25/milf"],
  bodyPart: ["feet", "pussy", "armpit", "belly", "boobs", "ass"],
  boobSubCategory: ["fake boobs", "natural boobs", "big boobs", "small boobs"],
  assSubCategory: ["twerking"],
  others: ["ahegao", "clothing", "public nudity", "cosplay", "bdsm", "alt", "tattoos", "piercings"],
}

function toggle(list: string[], value: string) {
  const v = value.toLowerCase()
  if (list.includes(v)) return list.filter((x) => x !== v)
  return [...list, v]
}

function titleCase(input: string) {
  return input
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

function labelize(item: string) {
  const s = item.replace(/\s+/g, " ").trim()
  if (!s) return s
  return titleCase(s)
}

function countSelected(selected: string[], all: string[]) {
  const set = new Set(selected.map((v) => v.toLowerCase()))
  return all.filter((x) => set.has(x.toLowerCase())).length
}

function Pills({
  items,
  selected,
  onToggle,
  disabled,
}: {
  items: string[]
  selected: string[]
  onToggle: (value: string) => void
  disabled: boolean
}) {
  const set = useMemo(() => new Set(selected.map((v) => v.toLowerCase())), [selected])

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const key = item.toLowerCase()
        const checked = set.has(key)
        return (
          <button
            key={item}
            type="button"
            onClick={() => onToggle(item)}
            disabled={disabled}
            aria-pressed={checked}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              checked
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-background text-foreground hover:bg-accent"
            } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            title={checked ? "Included" : "Not selected"}
          >
            {labelize(item)}
          </button>
        )
      })}
    </div>
  )
}

function SectionCard({
  title,
  description,
  items,
  selected,
  onToggle,
  disabled,
}: {
  title: string
  description: string
  items: string[]
  selected: string[]
  onToggle: (value: string) => void
  disabled: boolean
}) {
  const selectedCount = countSelected(selected, items)

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-foreground">
            Selected: <span className="font-semibold">{selectedCount}</span>
          </span>
          <span className="rounded-full border border-border bg-card px-2 py-1 text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{items.length}</span>
          </span>
        </div>
      </div>

      <div className="mt-3">
        <Pills items={items} selected={selected} onToggle={onToggle} disabled={disabled} />
      </div>
    </div>
  )
}

export default function CreatorProfile({ onBack, onSave, initialProfile, saving }: CreatorProfileProps) {
  const [includeEthnicity, setIncludeEthnicity] = useState<string[]>([])
  const [includeBodyType, setIncludeBodyType] = useState<string[]>([])
  const [includeAge, setIncludeAge] = useState<string[]>([])
  const [includeBodyPart, setIncludeBodyPart] = useState<string[]>([])
  const [includeBoobSubCategory, setIncludeBoobSubCategory] = useState<string[]>([])
  const [includeAssSubCategory, setIncludeAssSubCategory] = useState<string[]>([])
  const [includeOthers, setIncludeOthers] = useState<string[]>([])

  useEffect(() => {
    if (!initialProfile?.include) return
    setIncludeEthnicity(initialProfile.include.ethnicity ?? [])
    setIncludeBodyType(initialProfile.include.bodyType ?? [])
    setIncludeAge(initialProfile.include.age ?? [])
    setIncludeBodyPart(initialProfile.include.bodyPart ?? [])
    setIncludeBoobSubCategory(initialProfile.include.boobSubCategory ?? [])
    setIncludeAssSubCategory(initialProfile.include.assSubCategory ?? [])
    setIncludeOthers(initialProfile.include.others ?? [])
  }, [initialProfile])

  const resetProfile = () => {
    setIncludeEthnicity([])
    setIncludeBodyType([])
    setIncludeAge([])
    setIncludeBodyPart([])
    setIncludeBoobSubCategory([])
    setIncludeAssSubCategory([])
    setIncludeOthers([])
  }

  const handleSave = () => {
    const profile: CreatorProfileValues = {
      ethnicity: "any",
      bodyType: "any",
      hairColor: "any",
      ageBracket: "any",
      boobsType: "any",
      distinctiveFeatures: "",
      hardLimits: "",
      specialties: "",
      collabSolo: false,
      collabBoyGirl: false,
      collabGirlGirl: false,
      ethnicityOther: "",
      bodyTypeOther: "",
      hairColorOther: "",
      ageBracketOther: "",
      include: {
        ethnicity: includeEthnicity,
        bodyType: includeBodyType,
        age: includeAge,
        bodyPart: includeBodyPart,
        boobSubCategory: includeBoobSubCategory,
        assSubCategory: includeAssSubCategory,
        others: includeOthers,
      },
    }
    onSave(profile)
  }

  const isSaving = !!saving

  const selectedTotal =
    includeEthnicity.length +
    includeBodyType.length +
    includeAge.length +
    includeBodyPart.length +
    includeBoobSubCategory.length +
    includeAssSubCategory.length +
    includeOthers.length

  return (
    <div className="rounded-2xl border border-border bg-card p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Creator Profile</h2>
          <p className="text-xs text-muted-foreground">
            Click tags to <span className="font-semibold text-foreground">include</span> matching subreddits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
            Selected tags: <span className="ml-1 font-semibold text-foreground">{selectedTotal}</span>
          </span>

          <button
            type="button"
            onClick={onBack}
            disabled={isSaving}
            className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Back to Database
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background px-4 py-3">
        <div className="text-xs font-semibold text-foreground">How it works</div>
        <div className="mt-1 text-xs text-muted-foreground">
          If you select at least one tag, the database will show only subreddits tagged with any selected tag. If you
          select nothing, it shows all subreddits.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Ethnicity"
          description="Select ethnic-focused subreddits you match."
          items={OPTIONS.ethnicity}
          selected={includeEthnicity}
          onToggle={(v) => setIncludeEthnicity((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Body Type"
          description="Select subreddits centered around body-type labels."
          items={OPTIONS.bodyType}
          selected={includeBodyType}
          onToggle={(v) => setIncludeBodyType((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Age"
          description="Select age-vibe categories that fit."
          items={OPTIONS.age}
          selected={includeAge}
          onToggle={(v) => setIncludeAge((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Body Part"
          description="Select body-part niche subreddits you want."
          items={OPTIONS.bodyPart}
          selected={includeBodyPart}
          onToggle={(v) => setIncludeBodyPart((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Boob Sub Category"
          description="Select boob-specific subcategories."
          items={OPTIONS.boobSubCategory}
          selected={includeBoobSubCategory}
          onToggle={(v) => setIncludeBoobSubCategory((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Ass Sub Category"
          description="Select ass-specific subcategories."
          items={OPTIONS.assSubCategory}
          selected={includeAssSubCategory}
          onToggle={(v) => setIncludeAssSubCategory((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <div className="lg:col-span-2">
          <SectionCard
            title="Others"
            description="Select style/theme tags (cosplay, BDSM, alt, etc.)."
            items={OPTIONS.others}
            selected={includeOthers}
            onToggle={(v) => setIncludeOthers((prev) => toggle(prev, v))}
            disabled={isSaving}
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={resetProfile}
          disabled={isSaving}
          className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reset
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          aria-busy={isSaving}
          className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </div>
  )
}
