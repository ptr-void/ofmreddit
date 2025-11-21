"use client"

import { useEffect, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import s from "@/styles/scraper.module.css"

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
}

type CreatorProfileProps = {
  onBack: () => void
  onSave: (profile: CreatorProfileValues) => void
  initialProfile?: CreatorProfileValues | null
  saving?: boolean
}

export default function CreatorProfile({ onBack, onSave, initialProfile, saving }: CreatorProfileProps) {
  const [ethnicity, setEthnicity] = useState("any")
  const [bodyType, setBodyType] = useState("any")
  const [hairColor, setHairColor] = useState("any")
  const [ageBracket, setAgeBracket] = useState("any")
  const [boobsType, setBoobsType] = useState("any")
  const [distinctiveFeatures, setDistinctiveFeatures] = useState("")
  const [hardLimits, setHardLimits] = useState("")
  const [specialties, setSpecialties] = useState("")
  const [collabSolo, setCollabSolo] = useState(false)
  const [collabBoyGirl, setCollabBoyGirl] = useState(false)
  const [collabGirlGirl, setCollabGirlGirl] = useState(false)

  const [ethnicityOther, setEthnicityOther] = useState("")
  const [bodyTypeOther, setBodyTypeOther] = useState("")
  const [hairColorOther, setHairColorOther] = useState("")
  const [ageBracketOther, setAgeBracketOther] = useState("")

  useEffect(() => {
    if (!initialProfile) return
    setEthnicity(initialProfile.ethnicity ?? "any")
    setBodyType(initialProfile.bodyType ?? "any")
    setHairColor(initialProfile.hairColor ?? "any")
    setAgeBracket(initialProfile.ageBracket ?? "any")
    setBoobsType(initialProfile.boobsType ?? "any")
    setDistinctiveFeatures(initialProfile.distinctiveFeatures ?? "")
    setHardLimits(initialProfile.hardLimits ?? "")
    setSpecialties(initialProfile.specialties ?? "")
    setCollabSolo(initialProfile.collabSolo ?? false)
    setCollabBoyGirl(initialProfile.collabBoyGirl ?? false)
    setCollabGirlGirl(initialProfile.collabGirlGirl ?? false)
    setEthnicityOther(initialProfile.ethnicityOther ?? "")
    setBodyTypeOther(initialProfile.bodyTypeOther ?? "")
    setHairColorOther(initialProfile.hairColorOther ?? "")
    setAgeBracketOther(initialProfile.ageBracketOther ?? "")
  }, [initialProfile])

  const resetProfile = () => {
    setEthnicity("any")
    setBodyType("any")
    setHairColor("any")
    setAgeBracket("any")
    setBoobsType("any")
    setDistinctiveFeatures("")
    setHardLimits("")
    setSpecialties("")
    setCollabSolo(false)
    setCollabBoyGirl(false)
    setCollabGirlGirl(false)
    setEthnicityOther("")
    setBodyTypeOther("")
    setHairColorOther("")
    setAgeBracketOther("")
  }

  const handleSave = () => {
    const profile: CreatorProfileValues = {
      ethnicity,
      bodyType,
      hairColor,
      ageBracket,
      boobsType,
      distinctiveFeatures,
      hardLimits,
      specialties,
      collabSolo,
      collabBoyGirl,
      collabGirlGirl,
      ethnicityOther,
      bodyTypeOther,
      hairColorOther,
      ageBracketOther,
    }
    onSave(profile)
  }

  const isSaving = !!saving

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Creator Profile</h2>
          <p className="text-xs text-muted-foreground">
            Define the creator’s attributes, content boundaries, and collaboration preferences.
          </p>
        </div>

        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          Back to Database
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Physical Attributes & Tags</h3>

          <div className="mt-3 grid gap-4 md:grid-cols-4">
            <div className={`flex flex-col gap-1 ${ethnicity === "other" ? "md:col-span-1" : "md:col-span-2"}`}>
              <label className="text-xs font-medium text-foreground">Ethnicity</label>
              <Select value={ethnicity} onValueChange={setEthnicity}>
                <SelectTrigger className={s.csvinput}>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="asian">Asian</SelectItem>
                  <SelectItem value="latina">Latina</SelectItem>
                  <SelectItem value="white">White</SelectItem>
                  <SelectItem value="black">Black</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ethnicity === "other" && (
              <div className="flex flex-col gap-1 md:col-span-1">
                <label className="text-xs font-medium text-foreground">Specify ethnicity</label>
                <input
                  type="text"
                  value={ethnicityOther}
                  onChange={(e) => setEthnicityOther(e.target.value)}
                  placeholder="Describe ethnicity"
                  className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            )}

            <div className={`flex flex-col gap-1 ${bodyType === "other" ? "md:col-span-1" : "md:col-span-2"}`}>
              <label className="text-xs font-medium text-foreground">Body Type</label>
              <Select value={bodyType} onValueChange={setBodyType}>
                <SelectTrigger className={s.csvinput}>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="petite">Petite</SelectItem>
                  <SelectItem value="slim">Slim</SelectItem>
                  <SelectItem value="athletic">Athletic</SelectItem>
                  <SelectItem value="curvy">Curvy</SelectItem>
                  <SelectItem value="bbw">BBW</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bodyType === "other" && (
              <div className="flex flex-col gap-1 md:col-span-1">
                <label className="text-xs font-medium text-foreground">Specify body type</label>
                <input
                  type="text"
                  value={bodyTypeOther}
                  onChange={(e) => setBodyTypeOther(e.target.value)}
                  placeholder="Describe body type"
                  className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            )}

            <div className={`flex flex-col gap-1 ${hairColor === "other" ? "md:col-span-1" : "md:col-span-2"}`}>
              <label className="text-xs font-medium text-foreground">Hair Color</label>
              <Select value={hairColor} onValueChange={setHairColor}>
                <SelectTrigger className={s.csvinput}>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="blonde">Blonde</SelectItem>
                  <SelectItem value="brunette">Brunette</SelectItem>
                  <SelectItem value="black">Black</SelectItem>
                  <SelectItem value="red">Red</SelectItem>
                  <SelectItem value="colored">Dyed / Colored</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {hairColor === "other" && (
              <div className="flex flex-col gap-1 md:col-span-1">
                <label className="text-xs font-medium text-foreground">Specify hair color</label>
                <input
                  type="text"
                  value={hairColorOther}
                  onChange={(e) => setHairColorOther(e.target.value)}
                  placeholder="Describe hair color"
                  className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            )}

            <div className={`flex flex-col gap-1 ${ageBracket === "other" ? "md:col-span-1" : "md:col-span-2"}`}>
              <label className="text-xs font-medium text-foreground">Age Bracket</label>
              <Select value={ageBracket} onValueChange={setAgeBracket}>
                <SelectTrigger className={s.csvinput}>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="teen-look-18plus">Teen-looking (18+)</SelectItem>
                  <SelectItem value="early-20s">Early 20s vibe</SelectItem>
                  <SelectItem value="mid-20s">Mid 20s vibe</SelectItem>
                  <SelectItem value="late-20s-early-30s">Late 20s / early 30s</SelectItem>
                  <SelectItem value="milf-30s-plus">MILF / 30s+</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ageBracket === "other" && (
              <div className="flex flex-col gap-1 md:col-span-1">
                <label className="text-xs font-medium text-foreground">Specify age vibe</label>
                <input
                  type="text"
                  value={ageBracketOther}
                  onChange={(e) => setAgeBracketOther(e.target.value)}
                  placeholder="Describe age vibe"
                  className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            )}

            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-xs font-medium text-foreground">Boobs</label>
              <Select value={boobsType} onValueChange={setBoobsType}>
                <SelectTrigger className={s.csvinput}>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="natural">Natural</SelectItem>
                  <SelectItem value="fake">Fake</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-xs font-medium text-foreground">Distinctive Features</label>
              <input
                type="text"
                value={distinctiveFeatures}
                onChange={(e) => setDistinctiveFeatures(e.target.value)}
                placeholder="eg. tattoos, piercings, alt, etc."
                className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">Content Themes & Boundaries</h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Hard Limits (Will NOT show)</label>
              <textarea
                value={hardLimits}
                onChange={(e) => setHardLimits(e.target.value)}
                placeholder="List your hard limits or content you never do."
                className="min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Specialties (Primary Themes)</label>
              <textarea
                value={specialties}
                onChange={(e) => setSpecialties(e.target.value)}
                placeholder="e.g. girlfriend experience, teasing, JOI, cosplay, roleplay."
                className="min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">Collaboration Willingness</h3>

          <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={collabSolo}
                onChange={(e) => setCollabSolo(e.target.checked)}
                className="h-3 w-3 rounded border-border bg-background"
              />
              <span>Solo Only</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={collabBoyGirl}
                onChange={(e) => setCollabBoyGirl(e.target.checked)}
                className="h-3 w-3 rounded border-border bg-background"
              />
              <span>Boy/Girl Content</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={collabGirlGirl}
                onChange={(e) => setCollabGirlGirl(e.target.checked)}
                className="h-3 w-3 rounded border-border bg-background"
              />
              <span>Girl/Girl Content</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
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
