export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query, queryOne } from "@/lib/db"
import mammoth from "mammoth"
import { DOMParser } from "@xmldom/xmldom"
import { setTimeout as delay } from "node:timers/promises"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
const GEMINI_MODEL = process.env.CAPTION_GEMINI_MODEL || "gemini-3.8-flash"
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`
const CAPTION_PROMPT_NAME = "caption_generator"
const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024
const MAX_CAPTIONS = 10
const MAX_KNOWLEDGE_TEXT_CHARACTERS = 150_000

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

export async function POST(request: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Server configuration error: missing AI API key." }, { status: 500 })
    }

    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
        thinkingConfig: { thinkingLevel: "medium" },
      },
    }

    let response: Response | undefined
    // Retry only explicit transient responses; keep the requested model and prompt unchanged.
    const signal = AbortSignal.timeout(60_000)
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(API_URL, {
        method: "POST",
        signal,
        headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break
      const retryAfter = response.headers.get("retry-after")
      const seconds = retryAfter ? Number(retryAfter) : NaN
      const retryMilliseconds = retryAfter
        ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now())
        : 1000 * (2 ** attempt)
      if (Number.isFinite(retryMilliseconds) && retryMilliseconds > 5000) break
      await response.body?.cancel()
      await delay(Math.max(0, Number.isFinite(retryMilliseconds) ? retryMilliseconds : 1000 * (2 ** attempt)), undefined, { signal })
    }
    if (!response?.ok) {
      const status = response?.status === 429 ? 429 : response?.status === 503 ? 503 : 502
      console.error("Caption Gemini API error", { model: GEMINI_MODEL, status: response?.status })
      return NextResponse.json({
        error: status === 429 ? "Caption generation is temporarily rate limited. Please try again shortly."
          : status === 503 ? "Gemini is experiencing high demand. Please try again shortly." : "AI Generation Failed",
        model: GEMINI_MODEL,
      }, { status })
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return NextResponse.json({ error: "The AI did not finish generating captions. Please try again." }, { status: 502 })
    }
    const rawResponse = (candidate?.content?.parts || [])
      .filter((part: { thought?: boolean }) => !part.thought)
      .map((part: { text?: string }) => part.text || "")
      .join("")
      .trim()
    const captions = extractCaptions(rawResponse, requestData.posts[0].id)
    if (captions.length !== expectedCount) {
      console.error("Caption response did not match expected result count", { expectedCount, received: captions.length })
      return NextResponse.json({ error: "AI Generation Failed" }, { status: 502 })
    }

    return NextResponse.json({
      captions,
      rawOutput: rawResponse,
      meta: {
        interactiveMode,
        model: GEMINI_MODEL,
        knowledgeDocuments: documents.length,
        promptSource: "admin",
        generationMode: "gem-style",
        expectedCount,
      },
    })
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "Error"
    if (name === "TimeoutError" || name === "AbortError") {
      return NextResponse.json({ error: "Caption generation timed out. Please try again shortly.", model: GEMINI_MODEL }, { status: 504 })
    }
    const message = error instanceof Error ? error.message : "Internal Server Error"
    console.error("Caption generation error:", { name, message })
    return NextResponse.json({ error: "Caption generation failed. Please try again.", model: GEMINI_MODEL }, { status: 500 })
  }
}