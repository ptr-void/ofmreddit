// components/reddit-database/creator-profile.tsx
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
  excluded: {
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
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-background text-foreground hover:bg-accent"
            } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            title={checked ? "Excluded" : "Included"}
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
  const excludedCount = countSelected(selected, items)
  const includedCount = items.length - excludedCount

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full border border-border bg-card px-2 py-1 text-muted-foreground">
            Included: <span className="font-semibold text-foreground">{includedCount}</span>
          </span>
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive">
            Excluded: <span className="font-semibold">{excludedCount}</span>
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
  const [excludedEthnicity, setExcludedEthnicity] = useState<string[]>([])
  const [excludedBodyType, setExcludedBodyType] = useState<string[]>([])
  const [excludedAge, setExcludedAge] = useState<string[]>([])
  const [excludedBodyPart, setExcludedBodyPart] = useState<string[]>([])
  const [excludedBoobSubCategory, setExcludedBoobSubCategory] = useState<string[]>([])
  const [excludedAssSubCategory, setExcludedAssSubCategory] = useState<string[]>([])
  const [excludedOthers, setExcludedOthers] = useState<string[]>([])

  useEffect(() => {
    if (!initialProfile?.excluded) return
    setExcludedEthnicity(initialProfile.excluded.ethnicity ?? [])
    setExcludedBodyType(initialProfile.excluded.bodyType ?? [])
    setExcludedAge(initialProfile.excluded.age ?? [])
    setExcludedBodyPart(initialProfile.excluded.bodyPart ?? [])
    setExcludedBoobSubCategory(initialProfile.excluded.boobSubCategory ?? [])
    setExcludedAssSubCategory(initialProfile.excluded.assSubCategory ?? [])
    setExcludedOthers(initialProfile.excluded.others ?? [])
  }, [initialProfile])

  const resetProfile = () => {
    setExcludedEthnicity([])
    setExcludedBodyType([])
    setExcludedAge([])
    setExcludedBodyPart([])
    setExcludedBoobSubCategory([])
    setExcludedAssSubCategory([])
    setExcludedOthers([])
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
      excluded: {
        ethnicity: excludedEthnicity,
        bodyType: excludedBodyType,
        age: excludedAge,
        bodyPart: excludedBodyPart,
        boobSubCategory: excludedBoobSubCategory,
        assSubCategory: excludedAssSubCategory,
        others: excludedOthers,
      },
    }
    onSave(profile)
  }

  const isSaving = !!saving

  const excludedTotal =
    excludedEthnicity.length +
    excludedBodyType.length +
    excludedAge.length +
    excludedBodyPart.length +
    excludedBoobSubCategory.length +
    excludedAssSubCategory.length +
    excludedOthers.length

  return (
    <div className="rounded-2xl border border-border bg-card p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Creator Profile</h2>
          <p className="text-xs text-muted-foreground">
            Click tags to <span className="font-semibold text-foreground">exclude</span> subreddits that don’t apply.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
            Excluded tags: <span className="ml-1 font-semibold text-foreground">{excludedTotal}</span>
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
          Every selected tag is treated as <span className="font-semibold text-foreground">excluded</span>. Any subreddit
          tagged with it will be hidden from the database.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Ethnicity"
          description="Exclude ethnic-focused subreddits you don’t match."
          items={OPTIONS.ethnicity}
          selected={excludedEthnicity}
          onToggle={(v) => setExcludedEthnicity((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Body Type"
          description="Exclude subreddits centered around body-type labels."
          items={OPTIONS.bodyType}
          selected={excludedBodyType}
          onToggle={(v) => setExcludedBodyType((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Age"
          description="Exclude age-vibe categories that don’t fit."
          items={OPTIONS.age}
          selected={excludedAge}
          onToggle={(v) => setExcludedAge((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Body Part"
          description="Exclude body-part niche subreddits you don’t want."
          items={OPTIONS.bodyPart}
          selected={excludedBodyPart}
          onToggle={(v) => setExcludedBodyPart((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Boob Sub Category"
          description="Exclude boob-specific subcategories."
          items={OPTIONS.boobSubCategory}
          selected={excludedBoobSubCategory}
          onToggle={(v) => setExcludedBoobSubCategory((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <SectionCard
          title="Ass Sub Category"
          description="Exclude ass-specific subcategories."
          items={OPTIONS.assSubCategory}
          selected={excludedAssSubCategory}
          onToggle={(v) => setExcludedAssSubCategory((prev) => toggle(prev, v))}
          disabled={isSaving}
        />

        <div className="lg:col-span-2">
          <SectionCard
            title="Others"
            description="Exclude style/theme tags (cosplay, BDSM, alt, etc.)."
            items={OPTIONS.others}
            selected={excludedOthers}
            onToggle={(v) => setExcludedOthers((prev) => toggle(prev, v))}
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
