export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Leave room for knowledge downloads plus the bounded 120-second generation/retry window.
export const maxDuration = 180

import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query, queryOne } from "@/lib/db"
import mammoth from "mammoth"
import { DOMParser } from "@xmldom/xmldom"
import { setTimeout as delay } from "node:timers/promises"
import { captionAccessForUser, CAPTION_PAUSED_MESSAGE } from "@/lib/caption-access"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
const GEMINI_MODEL = process.env.CAPTION_GEMINI_MODEL || "gemini-3.8-flash"
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`
const CAPTION_PROMPT_NAME = "caption_generator"
const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024
const MAX_CAPTIONS = 10
const MAX_KNOWLEDGE_TEXT_CHARACTERS = 150_000
const GENERATION_TIMEOUT_MS = 120_000
const ATTEMPT_TIMEOUT_MS = 45_000
const requestedThinking = process.env.CAPTION_GEMINI_THINKING_LEVEL
const THINKING_LEVEL = requestedThinking === "medium" || requestedThinking === "high" ? requestedThinking : "low"

interface GeminiResponse {
  promptFeedback?: {
    blockReason?: string
    safetyRatings?: Array<{ category?: string; blocked?: boolean }>
  }
  candidates?: Array<{
    finishReason?: string
    safetyRatings?: Array<{ category?: string; blocked?: boolean }>
    content?: { parts?: Array<{ thought?: boolean; text?: string }> }
  }>
}

interface GeminiErrorResponse {
  error?: { status?: string; details?: Array<{ "@type"?: string; retryDelay?: string;
    violations?: Array<{ quotaId?: string; quotaValue?: string }> }> }
}

function dailyQuota(error?: GeminiErrorResponse): { limit?: number } | undefined {
  const violation = error?.error?.details
    ?.filter(detail => detail["@type"] === "type.googleapis.com/google.rpc.QuotaFailure")
    .flatMap(detail => detail.violations || [])
    .find(violation => /requests.*perday|requests.*daily/i.test(violation.quotaId || ""))
  if (!violation) return undefined
  const limit = Number(violation.quotaValue)
  return { ...(Number.isSafeInteger(limit) && limit > 0 ? { limit } : {}) }
}

function providerRetryMilliseconds(response: Response, error?: GeminiErrorResponse): number | undefined {
  const header = response.headers.get("retry-after")
  const seconds = header ? Number(header) : NaN
  const headerDelay = header ? Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now() : NaN
  const retryInfo = error?.error?.details?.find(detail => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo")
  const duration = retryInfo?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/)
  const bodyDelay = duration ? Number(duration[1]) * 1000 : NaN
  const valid = [headerDelay, bodyDelay].filter(value => Number.isFinite(value) && value >= 0)
  return valid.length ? Math.max(...valid) : undefined
}

type InteractiveMode = "ON" | "OFF"

interface Caption {
  option: string
  text: string
}

interface StoredPrompt {
  id: number
  prompt_text: string
}

interface KnowledgeDocument {
  id: number
  filename: string
  cloudinary_url: string
  file_type: string
  file_size: number | null
}

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

function normalizeInteractiveMode(raw: unknown): InteractiveMode {
  if (typeof raw === "boolean") return raw ? "ON" : "OFF"
  if (typeof raw === "string") {
    const value = raw.trim().toUpperCase()
    if (value === "ON" || value === "OFF") return value
  }
  return "OFF"
}

function normalizeMimeType(fileType: string, filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase()
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (extension === "doc") return "application/msword"
  if (extension === "pdf") return "application/pdf"
  return fileType || "application/octet-stream"
}

function extractCaptions(rawResponse: string, postId: string): Caption[] {
  const cleaned = rawResponse.replace(/^```(?:xml|json)?\s*|\s*```$/gi, "").trim()
  if (cleaned.startsWith("<")) {
    // Parse XML as data, never HTML. Reject DTDs, external entities and malformed output.
    if (/<!DOCTYPE|<!ENTITY/i.test(cleaned)) return []
    try {
      const document = new DOMParser({ onError: () => { throw new Error("Invalid caption XML") } })
        .parseFromString(cleaned, "application/xml")
      const root = document.documentElement
      if (!root || root.tagName !== "caption_results") return []
      const posts = Array.from(root.getElementsByTagName("post"))
      const selected = posts.length ? posts.find(post => post.getAttribute("id") === postId) : root
      if (!selected) return []
      const elements = Array.from(selected.getElementsByTagName("caption"))
      const texts = elements.length
        ? elements.map(element => element.textContent?.trim() || "")
        : selected.textContent?.split(/\r?\n/).map(line => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "")).filter(Boolean) || []
      return texts.filter(Boolean).map((text, index) => ({ option: `Caption ${index + 1}`, text }))
    } catch { return [] }
  }
  // Backward compatibility with JSON returned by older saved prompt versions.
  try {
    const parsed = JSON.parse(cleaned) as unknown
    const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).caption_results ?? (parsed as Record<string, unknown>).captions : []
    const items = Array.isArray(values) ? values : []
    return items.map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : null
      const text = typeof item === "string" ? item.trim() : String(record?.text ?? record?.caption ?? "").trim()
      return { option: String(record?.option ?? `Caption ${index + 1}`), text }
    }).filter(caption => Boolean(caption.text))
  } catch { return [] }
}

function expectedCaptionCount(prompt: string): number {
  const match = prompt.replace(/`/g, "").match(/exactly\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:<caption>|captions?)/i)
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
  const token = match?.[1]?.toLowerCase() || "five"
  const count = words.includes(token) ? words.indexOf(token) + 1 : Number(token)
  return Number.isInteger(count) && count >= 1 && count <= MAX_CAPTIONS ? count : 5
}

function normalizeFeatures(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return values.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
}

function optionalContext(input: Record<string, unknown>): Record<string, unknown> {
  const fields = {
    caption_mood: input.caption_mood ?? input.captionMood,
    creative_style: input.creative_style ?? input.creativeStyle,
    subreddit_type: input.subreddit_type ?? input.subredditType,
    subreddit_name: input.subreddit_name ?? input.subredditName,
    rules: input.rules,
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ""))
}

function postInput(body: Record<string, unknown>) {
  const posts = Array.isArray(body.posts) ? body.posts : []
  const firstPost = posts[0]
  return firstPost && typeof firstPost === "object" && !Array.isArray(firstPost)
    ? { ...body, ...(firstPost as Record<string, unknown>) }
    : body
}

async function loadKnowledgeParts(documents: KnowledgeDocument[]): Promise<GeminiPart[]> {
  const loaded = await Promise.all(documents.map(async (document) => {
    if (document.file_size && document.file_size > MAX_KNOWLEDGE_FILE_BYTES) {
      throw new Error(`${document.filename} exceeds the 20 MB knowledge-file limit`)
    }

    const response = await fetch(document.cloudinary_url, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`Could not load ${document.filename} (${response.status})`)

    const file = Buffer.from(await response.arrayBuffer())
    if (!file.length) throw new Error(`${document.filename} is empty`)
    if (file.length > MAX_KNOWLEDGE_FILE_BYTES) {
      throw new Error(`${document.filename} exceeds the 20 MB knowledge-file limit`)
    }

    const mimeType = normalizeMimeType(document.file_type, document.filename)
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const extracted = await mammoth.extractRawText({ buffer: file })
      const text = extracted.value.trim()
      if (!text) throw new Error(`Could not read text from ${document.filename}`)
      if (text.length > MAX_KNOWLEDGE_TEXT_CHARACTERS) {
        throw new Error(`${document.filename} is too large to include in a caption request`)
      }
      return {
        text: `BEGIN KNOWLEDGE FILE: ${document.filename}\n${text}\nEND KNOWLEDGE FILE: ${document.filename}`,
      } satisfies GeminiPart
    }

    return {
      text: `Knowledge file attached: ${document.filename}. Read and apply it together with the administrator instructions.`,
      inlineData: { mimeType, data: file.toString("base64") },
    } satisfies GeminiPart
  }))

  return loaded.flatMap((part) => part.inlineData
    ? [{ text: part.text || "Knowledge file attached." }, { inlineData: part.inlineData }]
    : [part])
}

export async function GET(request: NextRequest) {
  try {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1]
    const account = token ? verifyToken(token) : null
    if (!account || !Number.isSafeInteger(account.userId) || account.userId <= 0) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const access = await captionAccessForUser(account.userId)
    return NextResponse.json({ enabled: access.enabled, allowed: access.allowed, isAdmin: access.isAdmin },
      { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    return NextResponse.json({ error: "Failed to check caption access." }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    const account = token ? verifyToken(token) : null
    if (!account || !Number.isSafeInteger(account.userId) || account.userId <= 0) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!(await captionAccessForUser(account.userId)).allowed) {
      return NextResponse.json({ error: CAPTION_PAUSED_MESSAGE, code: "CAPTION_ACCESS_PAUSED", retryable: false }, { status: 403 })
    }
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Server configuration error: missing AI API key." }, { status: 500 })
    }

    const rawBody = await request.json()
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid caption request" }, { status: 400 })
    }
    if (Array.isArray(rawBody.posts) && rawBody.posts.length > 1) {
      return NextResponse.json({ error: "Generate captions for one post per request." }, { status: 400 })
    }
    const input = postInput(rawBody as Record<string, unknown>)
    const interactiveMode = normalizeInteractiveMode(input.isInteractive ?? input.interactive_mode ?? input.interactiveMode)

    const prompt = await queryOne<StoredPrompt>(
      "SELECT id, prompt_text FROM prompts WHERE name = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
      [CAPTION_PROMPT_NAME],
    )
    if (!prompt?.prompt_text?.trim()) {
      return NextResponse.json({ error: "Caption generator instructions have not been configured." }, { status: 503 })
    }

    const documents = await query<KnowledgeDocument>(
      `SELECT d.id, d.original_filename AS filename, d.cloudinary_url, d.file_type, d.file_size
         FROM documents d
        WHERE d.prompt_id = ?
        ORDER BY d.created_at ASC, d.id ASC`,
      [prompt.id],
    )
    if (!documents.length) {
      return NextResponse.json({ error: "Caption generator knowledge documents have not been configured." }, { status: 503 })
    }

    const knowledgeParts = await loadKnowledgeParts(documents)
    const requestData = {
      posts: [{
        id: String(input.id || "post_001"),
        gender: input.gender || "female",
        niche_features: normalizeFeatures(input.niche_features ?? input.nicheFeatures ?? input.physicalFeatures),
        degen_scale: input.degen_scale ?? input.degenScale ?? 2,
        interactive_mode: interactiveMode,
        clickbait_style: input.clickbait_style === "y" || input.clickbait_style === "n"
          ? input.clickbait_style : interactiveMode === "ON" ? "y" : "n",
        visual_context: input.visual_context ?? input.visualContext ?? "",
        content_type: String(input.content_type ?? input.contentType ?? "Picture").replace(/^./, letter => letter.toUpperCase()),
        ...(input.mode === "quick" ? {} : optionalContext(input)),
      }],
    }

    const expectedCount = expectedCaptionCount(prompt.prompt_text)
    // Preserve the Gem instructions verbatim. Convert output for UI cards only AFTER generation.
    const payload = {
      systemInstruction: { parts: [{ text: prompt.prompt_text }] },
      contents: [{
        role: "user",
        parts: [
          ...knowledgeParts,
          { text: `<request_data>\n${JSON.stringify(requestData, null, 2)}\n</request_data>` },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      },
    }

    let response: Response | undefined
    let data: GeminiResponse | undefined
    let transportFailure: string | undefined
    let providerError: GeminiErrorResponse | undefined
    let attempts = 0
    // A stalled attempt must not consume the whole retry budget. Body reads share
    // its deadline too: receiving headers is not a completed generation.
    const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
    for (let attempt = 0; attempt < 4; attempt++) {
      attempts++
      response = undefined
      data = undefined
      transportFailure = undefined
      providerError = undefined
      try {
        response = await fetch(API_URL, {
          method: "POST",
          signal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
          headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (response.ok) {
          data = await response.json() as GeminiResponse
          break
        }
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) break
        // Google often puts its cooldown in RetryInfo instead of Retry-After.
        providerError = await response.json().catch(error => {
          if (error?.name === "SyntaxError") return undefined
          throw error
        }) as GeminiErrorResponse | undefined
        // Per-day request exhaustion is not a transient overload. Retrying it
        // inside this invocation wastes requests and will never restore service.
        if (response.status === 429 && dailyQuota(providerError)) break
      } catch (error) {
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "Error"
        if (signal.aborted) throw error
        if (!["TimeoutError", "AbortError", "TypeError"].includes(name)) throw error
        transportFailure = name
        await response?.body?.cancel().catch(() => {})
        response = undefined
        console.warn("Caption Gemini attempt interrupted", { model: GEMINI_MODEL, attempt: attempts, name })
      }
      if (attempt === 3) break
      const retryMilliseconds = response ? providerRetryMilliseconds(response, providerError)
        ?? 1000 * (2 ** attempt) + Math.floor(Math.random() * 250)
        : 1000 * (2 ** attempt) + Math.floor(Math.random() * 250)
      if (Number.isFinite(retryMilliseconds) && retryMilliseconds > 5000) break
      if (!response?.bodyUsed) await response?.body?.cancel().catch(() => {})
      await delay(Math.max(0, Number.isFinite(retryMilliseconds) ? retryMilliseconds : 1000 * (2 ** attempt)), undefined, { signal })
    }
    if (!response?.ok || !data) {
      const timedOut = transportFailure === "TimeoutError" || transportFailure === "AbortError"
      const status = timedOut ? 504 : response?.status === 429 ? 429 : response?.status === 503 || transportFailure ? 503 : 502
      console.error("Caption Gemini API error", { model: GEMINI_MODEL, status: response?.status,
        providerStatus: providerError?.error?.status, transportFailure, attempts })
      const retryAfterSeconds = Math.max(1, Math.ceil((response ? providerRetryMilliseconds(response, providerError) ?? 10_000 : 10_000) / 1000))
      const quota = response?.status === 429 ? dailyQuota(providerError) : undefined
      if (quota) {
        const cooldown = response ? providerRetryMilliseconds(response, providerError) : undefined
        const quotaLimit = quota.limit ? ` (${quota.limit} requests/day)` : ""
        return NextResponse.json({
          error: `The Gemini API project's daily request limit for ${GEMINI_MODEL}${quotaLimit} has been reached. Short retries will not restore generation; wait for the quota reset or use a higher-quota API project.`,
          code: "DAILY_QUOTA_EXHAUSTED", model: GEMINI_MODEL, retryable: false,
          quota: { period: "day", ...quota },
          ...(cooldown !== undefined ? { retryAfterSeconds,
            retryAvailableAt: new Date(Date.now() + cooldown).toISOString() } : {}),
        }, { status: 429, ...(cooldown !== undefined ? { headers: { "Retry-After": String(retryAfterSeconds) } } : {}) })
      }
      const retryable = Boolean(transportFailure || response && [408, 429, 500, 502, 503, 504].includes(response.status))
      return NextResponse.json({
        error: timedOut ? "Caption generation timed out. Please try again shortly."
          : transportFailure ? "The caption service connection was interrupted. Please try again shortly."
          : status === 429 ? "Caption generation is temporarily rate limited. Please try again shortly."
          : status === 503 ? "Gemini is experiencing high demand. Please try again shortly." : "AI Generation Failed",
        model: GEMINI_MODEL,
        retryable,
        ...(retryable ? { retryAfterSeconds } : {}),
      }, { status, ...(retryable ? { headers: { "Retry-After": String(retryAfterSeconds) } } : {}) })
    }

    const candidate = data.candidates?.[0]
    const promptBlock = data.promptFeedback?.blockReason
    const finishReason = candidate?.finishReason
    const blockedCategories = [...(data.promptFeedback?.safetyRatings || []), ...(candidate?.safetyRatings || [])]
      .filter(rating => rating.blocked && rating.category).map(rating => rating.category!)
    const contentBlockReasons = ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "ESCALATION", "PUP_LIMITED_DISABLED"]
    if (promptBlock && promptBlock !== "BLOCK_REASON_UNSPECIFIED" ||
        finishReason && contentBlockReasons.includes(finishReason) || blockedCategories.length) {
      const providerReason = promptBlock && promptBlock !== "BLOCK_REASON_UNSPECIFIED" ? promptBlock : finishReason || "SAFETY"
      // Return metadata only, never blocked/partial generated text or the user's keywords.
      console.warn("Caption Gemini content blocked", { model: GEMINI_MODEL, providerReason, blockedCategories, attempts })
      return NextResponse.json({
        error: "Gemini blocked this caption request under its content policy. This is not a timeout or a busy-service error. Sexual content involving minors or ambiguous ages is not supported; all subjects must be adults.",
        code: "CONTENT_BLOCKED", model: GEMINI_MODEL, retryable: false,
        providerReason, blockedCategories: [...new Set(blockedCategories)],
      }, { status: 422 })
    }
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return NextResponse.json({ error: "Gemini stopped before completing the caption response.",
        code: "GENERATION_INCOMPLETE", model: GEMINI_MODEL, retryable: false, providerReason: candidate.finishReason }, { status: 502 })
    }
    const rawResponse = (candidate?.content?.parts || [])
      .filter((part: { thought?: boolean }) => !part.thought)
      .map((part: { text?: string }) => part.text || "")
      .join("")
      .trim()
    const captions = extractCaptions(rawResponse, requestData.posts[0].id)
    if (captions.length !== expectedCount) {
      console.error("Caption response did not match expected result count", { expectedCount, received: captions.length })
      return NextResponse.json({
        error: `Gemini did not return the required ${expectedCount}-caption format. This can happen when the model returns an explanation or declines a request instead of captions.`,
        code: "INVALID_CAPTION_OUTPUT", model: GEMINI_MODEL, retryable: false,
      }, { status: 502 })
    }

    return NextResponse.json({
      captions,
      rawOutput: rawResponse,
      meta: {
        interactiveMode,
        model: GEMINI_MODEL,
        thinkingLevel: THINKING_LEVEL,
        knowledgeDocuments: documents.length,
        promptSource: "admin",
        generationMode: "gem-style",
        expectedCount,
        attempts,
      },
    })
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "Error"
    if (name === "TimeoutError" || name === "AbortError") {
      return NextResponse.json({ error: "Caption generation timed out. Please try again shortly.", model: GEMINI_MODEL,
        retryable: true, retryAfterSeconds: 10 }, { status: 504, headers: { "Retry-After": "10" } })
    }
    const message = error instanceof Error ? error.message : "Internal Server Error"
    console.error("Caption generation error:", { name, message })
    return NextResponse.json({ error: "Caption generation failed. Please try again.", model: GEMINI_MODEL }, { status: 500 })
  }
}
