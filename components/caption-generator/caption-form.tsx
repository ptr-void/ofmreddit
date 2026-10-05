"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { FormData } from "@/app/caption-generator/page"
import { Upload, ChevronDown, ChevronUp, Loader2 } from "lucide-react"

type CaptionFormProps = {
  onGenerate: (data: FormData) => void
  isGenerating: boolean
  accessDisabled?: boolean
  error?: string | null
}

const loadSavedCreatorFeatures = () => {
  if (typeof window === "undefined") return { physicalFeatures: "", gender: "female" as const }

  try {
    const savedFeatures = localStorage.getItem("creatorFeatures")
    if (savedFeatures) {
      const parsed = JSON.parse(savedFeatures)
      return {
        physicalFeatures: parsed.physicalFeatures || "",
        gender: (parsed.gender || "female") as "female" | "male" | "trans",
      }
    }
  } catch (error) {
    console.error("Failed to load creator features:", error)
  }

  return { physicalFeatures: "", gender: "female" as const }
}

export function CaptionForm({ onGenerate, isGenerating, error, accessDisabled = false }: CaptionFormProps) {
  const savedFeatures = loadSavedCreatorFeatures()

  const [formData, setFormData] = useState<FormData>({
    mode: "quick",
    physicalFeatures: savedFeatures.physicalFeatures,
    gender: savedFeatures.gender,
    subredditType: "generalist",
    visualContext: "",
    degenScale: 2,
    captionMood: "",
    rules: "",
    creativeStyle: "fantasy",
    isInteractive: false,
    subredditName: "",
    contentType: "picture",
  })
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormData, string>>>({})
  const [dragCounter, setDragCounter] = useState(0)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "analyzing" | "success" | "error">("idle")
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isBlurred, setIsBlurred] = useState(true)
  const [isAdvancedMenuOpen, setIsAdvancedMenuOpen] = useState(false)
  const [isContentDetailsOpen, setIsContentDetailsOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const creatorFeatures = {
      physicalFeatures: formData.physicalFeatures,
      gender: formData.gender,
    }
    localStorage.setItem("creatorFeatures", JSON.stringify(creatorFeatures))
  }, [formData.physicalFeatures, formData.gender])

  useEffect(() => {
    const errors: Partial<Record<keyof FormData, string>> = {}

    if (formData.mode === "quick") {
      if (!formData.physicalFeatures.trim() || !formData.visualContext.trim()) {
        errors.physicalFeatures = "Please upload and analyze an image first"
      }
    } else if (formData.mode === "keywords") {
      if (!formData.physicalFeatures.trim()) {
        errors.physicalFeatures = "Keywords are required"
      }
    } else if (formData.mode === "advanced") {
      if (!formData.physicalFeatures.trim()) {
        errors.physicalFeatures = "Creator's niche/features is required"
      }

      if (!formData.gender) {
        errors.gender = "Gender is required"
      }

      if (!formData.visualContext.trim()) {
        errors.visualContext = "Visual context is required"
      }

      if (!formData.subredditName.trim() && !formData.subredditType) {
        errors.subredditType = "Subreddit name or category is required"
      }
    }

    setFormErrors(errors)
  }, [formData])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (accessDisabled) return
    if (Object.keys(formErrors).length > 0) {
      console.log("Validation failed:", formErrors)
      return
    }
    onGenerate(formData)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, field: keyof FormData) => {
    setFormData((prev) => ({
      ...prev,
      [field]: e.target.value,
      ...(field === "subredditName" && e.target.value.trim() ? { subredditType: "" as FormData["subredditType"] } : {}),
    }))
  }

  const handleGenderChange = (value: string) => {
    setFormData((prev) => ({ ...prev, gender: value as "female" | "male" | "trans" }))
  }

  const handleToggleInteractive = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, isInteractive: checked }) as FormData)
  }

  const handleContentTypeChange = (value: string) => {
    setFormData((prev) => ({ ...prev, contentType: value as "picture" | "picture set" | "GIF/short video" }))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => prev + 1)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => prev - 1)
  }

  const toggleAdvancedMenu = () => {
    setIsAdvancedMenuOpen((prev) => !prev)
  }

  const toggleContentDetails = () => {
    setIsContentDetailsOpen((prev) => !prev)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(0)
    setIsBlurred(true)

    const files = Array.from(e.dataTransfer.files)
    const imageFile = files.find((file) => file.type.startsWith("image/"))

    if (!imageFile) {
      setAnalysisStatus("error")
      setTimeout(() => setAnalysisStatus("idle"), 3000)
      return
    }

    await analyzeImage(imageFile)
  }

  const analyzeImage = async (file: File) => {
    if (accessDisabled) return
    setIsAnalyzing(true)
    setAnalysisStatus("analyzing")

    try {
      const token = localStorage.getItem("token")
      if (!token) {
        throw new Error("Not authenticated. Please log in.")
      }

      const reader = new FileReader()

      reader.onload = async () => {
        const base64Image = reader.result as string
        setImageUrl(base64Image)

        try {
          const response = await fetch("/api/analyze-image", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ imageData: base64Image }),
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
            if (response.status === 503) {
              throw new Error("The AI service is currently overloaded. Please try again in a few moments.")
            } else if (response.status === 429) {
              throw new Error("Too many requests. Please wait a moment and try again.")
            } else {
              throw new Error(errorData.error || `Failed to analyze image (${response.status})`)
            }
          }

          const data = await response.json()
          const analysis = data.analysis

          let physicalFeaturesText = ""
          if (analysis.physicalAttributes) {
            const attrs = analysis.physicalAttributes
            const features = []
            if (attrs.hairColor) features.push(attrs.hairColor)
            if (attrs.hairStyle) features.push(attrs.hairStyle)
            if (attrs.ethnicity) features.push(attrs.ethnicity)
            if (attrs.bodyType) features.push(attrs.bodyType)
            if (attrs.notableFeatures && Array.isArray(attrs.notableFeatures)) {
              features.push(...attrs.notableFeatures)
            }
            physicalFeaturesText = features.join(", ")
          }

          let visualContextText = ""
          const contextParts = []
          if (analysis.setting) contextParts.push(analysis.setting)
          if (analysis.pose) contextParts.push(analysis.pose)
          if (analysis.clothing?.outfit) contextParts.push(analysis.clothing.outfit)
          if (analysis.visualElements && Array.isArray(analysis.visualElements)) {
            contextParts.push(...analysis.visualElements.slice(0, 2))
          }
          visualContextText = contextParts.join(", ")

          let inferredGender: "female" | "male" | "trans" = "female"
          if (analysis.contentType) {
            const contentLower = analysis.contentType.toLowerCase()
            if (contentLower.includes("male") && !contentLower.includes("female")) {
              inferredGender = "male"
            } else if (contentLower.includes("trans")) {
              inferredGender = "trans"
            }
          }

          let mappedContentType: "picture" | "picture set" | "GIF/short video" = "picture"
          if (analysis.contentType) {
            const typeLower = analysis.contentType.toLowerCase()
            if (typeLower.includes("set") || typeLower.includes("multiple")) {
              mappedContentType = "picture set"
            } else if (typeLower.includes("gif") || typeLower.includes("video")) {
              mappedContentType = "GIF/short video"
            }
          }

          setFormData((prev) => ({
            ...prev,
            physicalFeatures: physicalFeaturesText || prev.physicalFeatures,
            gender: inferredGender,
            visualContext: visualContextText || prev.visualContext,
            contentType: mappedContentType,
            captionMood: analysis.mood || prev.captionMood,
          }))

          setAnalysisStatus("success")
          setTimeout(() => setAnalysisStatus("idle"), 3000)
        } catch (fetchError: any) {
          throw fetchError
        }
      }

      reader.onerror = () => {
        throw new Error("Failed to read image file")
      }

      reader.readAsDataURL(file)
    } catch (error: any) {
      console.error("Error analyzing image:", error)
      if (typeof window !== "undefined" && (window as any).toast) {
        ;(window as any).toast({
          title: "Analysis Failed",
          description: error.message || "Failed to analyze image. Please try again.",
          variant: "destructive",
        })
      }
      setAnalysisStatus("error")
      setImageUrl(null)
      setFormData((prev) => ({
        ...prev,
        physicalFeatures: "",
        gender: "female" as "female" | "male" | "trans",
        visualContext: "",
        contentType: "picture" as "picture" | "picture set" | "GIF/short video",
        captionMood: "",
      }))
      setTimeout(() => setAnalysisStatus("idle"), 3000)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleToggleBlur = () => {
    setIsBlurred((prev) => !prev)
  }

  const isDragging = dragCounter > 0

  return (
    <TooltipProvider>
      <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto">
        {error && <div className="p-4 bg-red-100 text-red-700 rounded-lg">{error}</div>}

        <div className="space-y-2">
          <Label className="text-[var(--card-foreground)] text-lg">Mode</Label>
          <Tabs
            value={formData.mode}
            onValueChange={(v) => setFormData((prev) => ({ ...prev, mode: v as "keywords" | "advanced" | "quick" }))}
          >
            <TabsList className="grid w-full grid-cols-3 bg-[var(--muted)]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="quick"
                    style={{
                      backgroundColor: formData.mode === "quick" ? "var(--primary)" : "var(--muted)",
                      color: formData.mode === "quick" ? "var(--primary-foreground)" : "var(--card-foreground)",
                      border: formData.mode === "quick" ? "1px solid var(--primary)" : "none",
                    }}
                    className="w-full h-full hover:bg-[var(--secondary)] transition-colors duration-200"
                  >
                    Quick Generate
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>
                    Upload an image and let AI analyze it automatically. You only adjust strategic preferences like tone
                    and subreddit context.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="keywords"
                    style={{
                      backgroundColor: formData.mode === "keywords" ? "var(--primary)" : "var(--muted)",
                      color: formData.mode === "keywords" ? "var(--primary-foreground)" : "var(--card-foreground)",
                      border: formData.mode === "keywords" ? "1px solid var(--primary)" : "none",
                    }}
                    className="w-full h-full hover:bg-[var(--secondary)] transition-colors duration-200"
                  >
                    Keywords Mode
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>
                    Provide keywords (niche, visual context, mood), and the AI will automatically infer the best caption
                    strategy for your post.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="advanced"
                    style={{
                      backgroundColor: formData.mode === "advanced" ? "var(--primary)" : "var(--muted)",
                      color: formData.mode === "advanced" ? "var(--primary-foreground)" : "var(--card-foreground)",
                      border: formData.mode === "advanced" ? "1px solid var(--primary)" : "none",
                    }}
                    className="w-full h-full hover:bg-[var(--secondary)] transition-colors duration-200"
                  >
                    Advanced Mode
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>
                    Provides maximum strategic control. You define the subreddit context, visual details, and mood to
                    receive highly tailored captions.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TabsList>
          </Tabs>
        </div>

        {formData.mode === "quick" && (
          <div
            className="space-y-6"
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ${
                isDragging
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 scale-[1.02]"
                  : analysisStatus === "success"
                    ? "border-green-500 bg-green-50"
                    : analysisStatus === "error"
                      ? "border-red-500 bg-red-50"
                      : analysisStatus === "analyzing"
                        ? "border-yellow-500 bg-yellow-50"
                        : "border-[var(--border)] bg-[var(--muted)]/30"
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                {analysisStatus === "analyzing" ? (
                  <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
                ) : (
                  <Upload
                    className={`w-12 h-12 ${
                      isDragging
                        ? "text-[var(--primary)]"
                        : analysisStatus === "success"
                          ? "text-green-500"
                          : analysisStatus === "error"
                            ? "text-red-500"
                            : "text-[var(--muted-foreground)]"
                    }`}
                  />
                )}
                <p
                  className={`text-base font-medium ${
                    isDragging
                      ? "text-[var(--primary)]"
                      : analysisStatus === "success"
                        ? "text-green-600"
                        : analysisStatus === "error"
                          ? "text-red-600"
                          : analysisStatus === "analyzing"
                            ? "text-yellow-600"
                            : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {analysisStatus === "analyzing"
                    ? "Analyzing image... Please wait"
                    : analysisStatus === "success"
                      ? "Image analyzed successfully!"
                      : analysisStatus === "error"
                        ? "Failed to analyze image. Please try again"
                        : isDragging
                          ? "Drop image here to analyze"
                          : "Drag and drop an image here to get started"}
                </p>
              </div>
            </div>

            {imageUrl && !isAnalyzing && (
              <div className="relative w-full max-w-md mx-auto">
                <img
                  src={imageUrl || "/placeholder.svg"}
                  alt="Analyzed image"
                  className={`w-full h-auto rounded-lg object-contain max-h-64 transition-all duration-300 ${
                    isBlurred ? "blur-md" : ""
                  }`}
                />
                <Button
                  type="button"
                  onClick={handleToggleBlur}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-[var(--primary-foreground)] font-semibold rounded-lg shadow-lg z-10"
                >
                  {isBlurred ? "Unblur Image" : "Blur Image"}
                </Button>
              </div>
            )}

            <div className="border-2 border-[var(--border)] rounded-lg p-5 bg-[var(--card)] space-y-6">
              <h3 className="text-lg font-semibold text-[var(--card-foreground)]">Add Subreddit Context</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor="subredditName" className="w-fit text-[var(--card-foreground)]">
                          Subreddit Name
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>
                          Enter the subreddit name for tailored captions (r/example). This will auto-determine the
                          subreddit type.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-sm font-normal text-[var(--muted-foreground)]">(optional)</span>
                  </div>
                  <Input
                    id="quick-subreddit"
                    placeholder="r/example"
                    value={formData.subredditName}
                    onChange={(e) => handleChange(e, "subredditName")}
                    className="bg-[var(--card)] border-[var(--border)]"
                    disabled={isGenerating}
                  />
                </div>

                <div className="space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="w-fit mb-3 text-[var(--card-foreground)]">Subreddit Category</Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="mb-2">Determines the caption strategy based on the subreddit type.</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>
                          <strong>Generalist</strong>: For large, broad-appeal subreddits, e.g. r/slutsofsnapchat,
                          r/nude_selfie
                        </li>
                        <li>
                          <strong>Body/Attribute</strong>: Focused on specific physical traits or demographics, e.g.
                          r/boobs, r/latinas, r/foreverteens
                        </li>
                        <li>
                          <strong>Kink/Activity</strong>: Defined by a specific fetish, activity, or scenario, e.g.
                          r/daddysbrokentoys, r/twerking
                        </li>
                        <li>
                          <strong>Aesthetic/Subculture</strong>: For subcultures with a strong identity, like Goth or
                          Cosplay, r/gymgirls, r/bigtiddygothgf
                        </li>
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                  <Select
                    value={formData.subredditType}
                    onValueChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        subredditType: v as "generalist" | "body-specific" | "kink-specific" | "aesthetic",
                      }))
                    }
                    disabled={isGenerating || !!formData.subredditName.trim()}
                  >
                    <SelectTrigger className="w-full bg-[var(--card)] border-[var(--border)]">
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="generalist">Generalist Megahub</SelectItem>
                      <SelectItem value="body-specific">Body/Attribute Specific</SelectItem>
                      <SelectItem value="kink-specific">Kink/Activity Specific</SelectItem>
                      <SelectItem value="aesthetic">Aesthetic/Subculture</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  type="button"
                  onClick={toggleAdvancedMenu}
                  className="w-full flex items-center justify-between bg-[var(--card)] hover:bg-[var(--secondary)] text-[var(--card-foreground)] font-semibold rounded-lg"
                >
                  <span>Advanced Options</span>
                  {isAdvancedMenuOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </Button>

                {isAdvancedMenuOpen && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-3 border border-[var(--border)] rounded-lg p-4">
                            <Label className="w-fit text-[var(--card-foreground)] text-lg">Degen Scale</Label>
                            <div className="space-y-2 p-2">
                              <Slider
                                value={[formData.degenScale]}
                                onValueChange={(value) => setFormData((prev) => ({ ...prev, degenScale: value[0] }))}
                                min={1}
                                max={3}
                                step={1}
                                className="w-full [&>div]:h-6 [&>div]:cursor-pointer [&>div>span]:w-6 [&>div>span]:h-6"
                                disabled={isGenerating}
                              />
                              <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                                <span>Suggestive</span>
                                <span className="transform -translate-x-3">Direct</span>
                                <span>Explicit</span>
                              </div>
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p>Adjusts the intensity of the caption's tone.</p>
                          <ul className="list-disc pl-5 mt-2">
                            <li>
                              <strong>Suggestive</strong>: Subtle and hinting at content.
                            </li>
                            <li>
                              <strong>Direct</strong>: Clear and straightforward language.
                            </li>
                            <li>
                              <strong>Explicit</strong>: Bold and unambiguous phrasing.
                            </li>
                          </ul>
                        </TooltipContent>
                      </Tooltip>

                      <div className="space-y-3 border border-[var(--border)] rounded-lg p-4">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label className="w-fit text-[var(--card-foreground)] text-lg">Creative Style</Label>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p>Optionally refines the caption's narrative to focus on a specific type of scenario.</p>
                            <ul className="list-disc pl-5 mt-2">
                              <li>
                                <strong>Grounded Scenario</strong>: Generates captions describing a plausible,
                                real-world scenario to feel authentic and relatable.
                              </li>
                              <li>
                                <strong>Fantasy / Roleplay</strong>: Creates an immersive or escapist point-of-view
                                experience by framing the content as a fantasy scenario.
                              </li>
                              <li>
                                <strong>Kink-Specific</strong>: Uses specific jargon and scenarios for a narrow,
                                kink-focused audience to signal 'insider' knowledge.
                              </li>
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                        <RadioGroup
                          value={formData.creativeStyle}
                          onValueChange={(v) => setFormData((prev) => ({ ...prev, creativeStyle: v }))}
                          className="flex space-x-2"
                          disabled={isGenerating}
                        >
                          {[
                            { value: "grounded", label: "Grounded Scenario" },
                            { value: "fantasy", label: "Fantasy / Roleplay" },
                            { value: "kink", label: "Kink-Specific" },
                          ].map((option) => (
                            <div key={option.value} className="flex items-center space-x-2">
                              <RadioGroupItem value={option.value} id={`quick-style-${option.value}`} />
                              <Label
                                htmlFor={`quick-style-${option.value}`}
                                className="text-[var(--card-foreground)] cursor-pointer"
                              >
                                {option.label}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label htmlFor="mood" className="w-fit text-[var(--card-foreground)]">
                              Caption Mood
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs" side="right">
                            <p>This sets the emotional tone for your captions. playful, confident, shy, commanding</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-sm font-normal text-[var(--muted-foreground)]">(optional)</span>
                      </div>
                      <Input
                        id="quick-mood"
                        placeholder="playful, confident, shy, commanding"
                        value={formData.captionMood}
                        onChange={(e) => handleChange(e, "captionMood")}
                        className="bg-[var(--card)] border-[var(--border)]"
                        disabled={isGenerating}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label htmlFor="rules" className="w-fit text-[var(--card-foreground)]">
                              Rules
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs" side="right">
                            <p>Specify any title rules for the particular subreddit you're posting to. gender tag</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-sm font-normal text-[var(--muted-foreground)]">(optional)</span>
                      </div>
                      <Input
                        id="quick-rules"
                        placeholder="gender tag"
                        value={formData.rules}
                        onChange={(e) => handleChange(e, "rules")}
                        className="bg-[var(--card)] border-[var(--border)]"
                        disabled={isGenerating}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {formData.mode === "keywords" && (
          <div className="border-2 border-[var(--border)] rounded-lg p-5 bg-[var(--card)]">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="features" className="text-[var(--card-foreground)]">
                  Keywords <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="features"
                  placeholder="blonde, athletic, lingerie, bedroom setting"
                  value={formData.physicalFeatures}
                  onChange={(e) => handleChange(e, "physicalFeatures")}
                  className="bg-[var(--card)] border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] min-h-[80px]"
                  disabled={isGenerating}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 border border-[var(--border)] rounded-lg p-4">
                  <Label className="text-[var(--card-foreground)]">
                    Gender <span className="text-red-500">*</span>
                  </Label>
                  <Select value={formData.gender} onValueChange={handleGenderChange} disabled={isGenerating}>
                    <SelectTrigger className="w-full bg-[var(--card)] border-[var(--border)]">
                      <SelectValue placeholder="Select Gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="trans">Trans</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 border border-[var(--border)] rounded-lg p-4">
                  <Label className="w-fit text-[var(--card-foreground)]">Degen Scale</Label>
                  <div className="space-y-2 p-2">
                    <Slider
                      value={[formData.degenScale]}
                      onValueChange={(value) => setFormData((prev) => ({ ...prev, degenScale: value[0] }))}
                      min={1}
                      max={3}
                      step={1}
                      className="w-full [&>div]:h-6 [&>div]:cursor-pointer [&>div>span]:w-6 [&>div>span]:h-6"
                      disabled={isGenerating}
                    />
                    <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                      <span>Suggestive</span>
                      <span className="transform -translate-x-3">Direct</span>
                      <span>Explicit</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {formData.mode === "advanced" && (
          <>
            <div
              className="space-y-6"
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ${
                  isDragging
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 scale-[1.02]"
                    : analysisStatus === "success"
                      ? "border-green-500 bg-green-50"
                      : analysisStatus === "error"
                        ? "border-red-500 bg-red-50"
                        : analysisStatus === "analyzing"
                          ? "border-yellow-500 bg-yellow-50"
                          : "border-[var(--border)] bg-[var(--muted)]/30"
                }`}
              >
                <div className="flex flex-col items-center gap-3">
                  {analysisStatus === "analyzing" ? (
                    <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
                  ) : (
                    <Upload
                      className={`w-12 h-12 ${
                        isDragging
                          ? "text-[var(--primary)]"
                          : analysisStatus === "success"
                            ? "text-green-500"
                            : analysisStatus === "error"
                              ? "text-red-500"
                              : "text-[var(--muted-foreground)]"
                      }`}
                    />
                  )}
                  <p
                    className={`text-base font-medium ${
                      isDragging
                        ? "text-[var(--primary)]"
                        : analysisStatus === "success"
                          ? "text-green-600"
                          : analysisStatus === "error"
                            ? "text-red-600"
                            : analysisStatus === "analyzing"
                              ? "text-yellow-600"
                              : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    {analysisStatus === "analyzing"
                      ? "Analyzing image... Please wait"
                      : analysisStatus === "success"
                        ? "Image analyzed successfully!"
                        : analysisStatus === "error"
                          ? "Failed to analyze image. Please try again"
                          : isDragging
                            ? "Drop image here to analyze"
                            : "Drag and drop an image here to auto-fill fields"}
                  </p>
                </div>
              </div>

              {imageUrl && !isAnalyzing && (
                <div className="relative w-full max-w-md mx-auto">
                  <img
                    src={imageUrl || "/placeholder.svg"}
                    alt="Analyzed image"
                    className={`w-full h-auto rounded-lg object-contain max-h-64 transition-all duration-300 ${
                      isBlurred ? "blur-md" : ""
                    }`}
                  />
                  <Button
                    type="button"
                    onClick={handleToggleBlur}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-[var(--primary-foreground)] font-semibold rounded-lg shadow-lg z-10"
                  >
                    {isBlurred ? "Unblur Image" : "Blur Image"}
                  </Button>
                </div>
              )}

              <div className="border-2 border-[var(--border)] rounded-lg p-5 bg-[var(--card)]">
                <h3 className="text-lg font-semibold text-[var(--card-foreground)] mb-4">Creator Features</h3>
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start mb-4">
                  <div className="space-y-2">
                    <Label htmlFor="features" className="text-[var(--card-foreground)]">
                      Niche/Physical Features <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="features"
                      placeholder="cute, Japanese girl, anime, big natural boobs"
                      value={formData.physicalFeatures}
                      onChange={(e) => handleChange(e, "physicalFeatures")}
                      className="bg-[var(--card)] border-[var(--border)]"
                      disabled={isGenerating}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[var(--card-foreground)]">
                      Gender <span className="text-red-500">*</span>
                    </Label>
                    <Select value={formData.gender} onValueChange={handleGenderChange} disabled={isGenerating}>
                      <SelectTrigger className="w-full bg-[var(--card)] border-[var(--border)]">
                        <SelectValue placeholder="Select Gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="trans">Trans</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-[var(--card-foreground)] text-lg">Add Subreddit Context</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor="subredditName" className="w-fit text-[var(--card-foreground)]">
                          Subreddit Name
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>
                          Enter the subreddit name for tailored captions (r/example). This will auto-determine the
                          subreddit type.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-sm font-normal text-[var(--muted-foreground)]">(optional)</span>
                  </div>
                  <Input
                    id="subredditName"
                    placeholder="r/example"
                    value={formData.subredditName}
                    onChange={(e) => handleChange(e, "subredditName")}
                    className="bg-[var(--card)] border-[var(--border)]"
                    disabled={isGenerating}
                  />
                </div>
                <div className="space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="w-fit mb-3 text-[var(--card-foreground)]">Subreddit Category</Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="mb-2">Determines the caption strategy based on the subreddit type.</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>
                          <strong>Generalist</strong>: For large, broad-appeal subreddits, e.g. r/slutsofsnapchat,
                          r/nude_selfie
                        </li>
                        <li>
                          <strong>Body/Attribute</strong>: Focused on specific physical traits or demographics, e.g.
                          r/boobs, r/latinas, r/foreverteens
                        </li>
                        <li>
                          <strong>Kink/Activity</strong>: Defined by a specific fetish, activity, or scenario, e.g.
                          r/daddysbrokentoys, r/twerking
                        </li>
                        <li>
                          <strong>Aesthetic/Subculture</strong>: For subcultures with a strong identity, like Goth or
                          Cosplay, r/gymgirls, r/bigtiddygothgf
                        </li>
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                  <Select
                    value={formData.subredditType}
                    onValueChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        subredditType: v as "generalist" | "body-specific" | "kink-specific" | "aesthetic",
                      }))
                    }
                    disabled={isGenerating || !!formData.subredditName.trim()}
                  >
                    <SelectTrigger className="w-full bg-[var(--card)] border-[var(--border)]">
                      <SelectValue placeholder="Select Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="generalist">Generalist Megahub</SelectItem>
                      <SelectItem value="body-specific">Body/Attribute Specific</SelectItem>
                      <SelectItem value="kink-specific">Kink/Activity Specific</SelectItem>
                      <SelectItem value="aesthetic">Aesthetic/Subculture</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label htmlFor="context" className="w-fit text-[var(--card-foreground)]">
                      Visual Context <span className="text-red-500">*</span>
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p>
                      Describe the main action, setting, or focus of the content. This is not for a literal description,
                      but to provide creative inspiration for the captions. showering, sitting on gamer chair showing
                      boobs, titty reveal in the garden.
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Textarea
                  id="context"
                  placeholder="showering, sitting on gamer chair showing boobs"
                  value={formData.visualContext}
                  onChange={(e) => handleChange(e, "visualContext")}
                  className="bg-[var(--card)] border-[var(--border)] min-h-[80px]"
                  disabled={isGenerating}
                />
              </div>
              <div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label htmlFor="contentType" className="w-fit text-[var(--card-foreground)]">
                      Content Type
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p>
                      Specify the type of content to tailor the caption style. Influences how the caption describes the
                      media.
                    </p>
                  </TooltipContent>
                </Tooltip>
                <div className="space-y-3 border border-[var(--border)] h-[80px] bg-[var(--card)] rounded-lg mt-2 p-4">
                  <RadioGroup
                    value={formData.contentType}
                    onValueChange={handleContentTypeChange}
                    className="flex space-x-2"
                    disabled={isGenerating}
                  >
                    {[
                      { value: "picture", label: "Picture" },
                      { value: "picture set", label: "Picture Set" },
                      { value: "GIF/short video", label: "GIF/Short Video" },
                    ].map((option) => (
                      <div key={option.value} className="flex items-center py-4 space-x-2">
                        <RadioGroupItem value={option.value} id={`content-type-${option.value}`} />
                        <Label
                          htmlFor={`content-type-${option.value}`}
                          className="text-[var(--card-foreground)] cursor-pointer"
                        >
                          {option.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Button
                type="button"
                onClick={toggleContentDetails}
                className="w-full flex items-center justify-between bg-[var(--card)] hover:bg-[var(--secondary)] text-[var(--card-foreground)] font-semibold rounded-lg"
              >
                <span>Advanced Options</span>
                {isContentDetailsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </Button>

              {isContentDetailsOpen && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-[var(--card-foreground)] text-lg">Content Details</Label>
                  </div>

                  <div className="grid grid-cols-[1fr_1fr] gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="space-y-3 border border-[var(--border)] rounded-lg p-4 max-w-md">
                          <Label className="w-fit text-[var(--card-foreground)] text-lg">Degen Scale</Label>
                          <div className="space-y-2 p-2">
                            <Slider
                              value={[formData.degenScale]}
                              onValueChange={(value) => setFormData((prev) => ({ ...prev, degenScale: value[0] }))}
                              min={1}
                              max={3}
                              step={1}
                              className="w-full [&>div]:h-6 [&>div]:cursor-pointer [&>div>span]:w-6 [&>div>span]:h-6"
                              disabled={isGenerating}
                            />
                            <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                              <span>Suggestive</span>
                              <span className="transform -translate-x-3">Direct</span>
                              <span>Explicit</span>
                            </div>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>Adjusts the intensity of the caption's tone.</p>
                        <ul className="list-disc pl-5 mt-2">
                          <li>
                            <strong>Suggestive</strong>: Subtle and hinting at content.
                          </li>
                          <li>
                            <strong>Direct</strong>: Clear and straightforward language.
                          </li>
                          <li>
                            <strong>Explicit</strong>: Bold and unambiguous phrasing.
                          </li>
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                    <div className="space-y-3 border border-[var(--border)] rounded-lg p-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Label className="w-fit text-[var(--card-foreground)] text-lg">Creative Style</Label>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p>Optionally refines the caption's narrative to focus on a specific type of scenario.</p>
                          <ul className="list-disc pl-5 mt-2">
                            <li>
                              <strong>Grounded Scenario</strong>: Generates captions describing a plausible, real-world
                              scenario to feel authentic and relatable.
                            </li>
                            <li>
                              <strong>Fantasy / Roleplay</strong>: Creates an immersive or escapist point-of-view
                              experience by framing the content as a fantasy scenario.
                            </li>
                            <li>
                              <strong>Kink-Specific</strong>: Uses specific jargon and scenarios for a narrow,
                              kink-focused audience to signal 'insider' knowledge.
                            </li>
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                      <RadioGroup
                        value={formData.creativeStyle}
                        onValueChange={(v) => setFormData((prev) => ({ ...prev, creativeStyle: v }))}
                        className="flex space-x-2"
                        disabled={isGenerating}
                      >
                        {[
                          { value: "grounded", label: "Grounded Scenario" },
                          { value: "fantasy", label: "Fantasy / Roleplay" },
                          { value: "kink", label: "Kink-Specific" },
                        ].map((option) => (
                          <div key={option.value} className="flex items-center space-x-2">
                            <RadioGroupItem value={option.value} id={`style-${option.value}`} />
                            <Label
                              htmlFor={`style-${option.value}`}
                              className="text-[var(--card-foreground)] cursor-pointer"
                            >
                              {option.label}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Label htmlFor="mood" className="w-fit text-[var(--card-foreground)]">
                            Caption Mood
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs" side="right">
                          <p>This sets the emotional tone for your captions. playful, confident, shy, commanding</p>
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-sm font-normal text-[var(--muted-foreground)]">(optional)</span>
                    </div>
                    <Input
                      id="mood"
                      placeholder="playful, confident, shy, commanding"
                      value={formData.captionMood}
                      onChange={(e) => handleChange(e, "captionMood")}
                      className="bg-[var(--card)] border-[var(--border)]"
                      disabled={isGenerating}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Label htmlFor="rules" className="w-fit text-[var(--card-foreground)]">
                            Rules
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs" side="right">
                          <p>Specify any title rules for the particular subreddit you're posting to. gender tag</p>
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-sm font-normal text-[var(--muted-foreground)]">(optional)</span>
                    </div>
                    <Input
                      id="rules"
                      placeholder="gender tag"
                      value={formData.rules}
                      onChange={(e) => handleChange(e, "rules")}
                      className="bg-[var(--card)] border-[var(--border)]"
                      disabled={isGenerating}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex items-center space-x-2 my-8">
          <div
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => !isGenerating && handleToggleInteractive(!formData.isInteractive)}
          >
            <div
              className={`relative w-16 h-7 rounded-full transition-colors duration-200 ${
                formData.isInteractive ? "bg-blue-600" : "bg-gray-300"
              } ${isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
              role="switch"
              aria-checked={formData.isInteractive}
              aria-disabled={isGenerating}
            >
              <span
                className={`absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full transition-transform duration-200 ${
                  formData.isInteractive ? "translate-x-[2.25rem]" : "translate-x-1"
                }`}
              />
              <span
                className={`absolute top-1/2 -translate-y-1/2 text-white text-xs font-bold transition-opacity duration-200 ${
                  formData.isInteractive ? "left-2 opacity-100" : "left-2 opacity-0"
                }`}
              >
                ON
              </span>
              <span
                className={`absolute top-1/2 -translate-y-1/2 text-gray-600 text-xs font-bold transition-opacity duration-200 ${
                  !formData.isInteractive ? "right-2 opacity-100" : "right-2 opacity-0"
                }`}
              >
                OFF
              </span>
            </div>

            <Label className="text-[var(--card-foreground)] text-lg flex items-center space-x-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>Interactive/Clickbait Captions</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs" side="right">
                  <p>
                    Enable to generate interactive/clickbait captions (e.g., "Would you introduce me to your parents?")
                    that encourage comments like "yes" or "no".
                  </p>
                </TooltipContent>
              </Tooltip>
              <span className="text-sm font-normal">(beware some subreddits do not allow questions)</span>
            </Label>
          </div>
        </div>

        <Button
          type="submit"
          disabled={accessDisabled || isGenerating || isAnalyzing || Object.keys(formErrors).length > 0}
          className="w-full bg-[var(--primary)] hover:bg-[var(--primary)]/90 h-12 text-base font-semibold disabled:opacity-50 mb-10"
        >
          {isGenerating ? "Generating..." : isAnalyzing ? "Analyzing Image..." : "Generate Captions"}
        </Button>
      </form>
    </TooltipProvider>
  )
}
