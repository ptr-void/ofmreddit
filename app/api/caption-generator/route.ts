export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query, queryOne } from "@/lib/db"
import mammoth from "mammoth"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"
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

function extractCaptions(rawResponse: string): Caption[] {
  const cleaned = rawResponse.replace(/```(?:json)?|```/gi, "").trim()
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    const parsed = JSON.parse(jsonMatch?.[0] || cleaned) as unknown
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).caption_results ?? (parsed as Record<string, unknown>).captions ?? (parsed as Record<string, unknown>).posts
        : []
    const items = Array.isArray(values)
      ? values
      : values && typeof values === "object" && Array.isArray((values as Record<string, unknown>).captions)
        ? (values as Record<string, unknown>).captions as unknown[]
        : []

    return items
      .map((item, index) => {
        if (typeof item === "string") return { option: `Caption ${index + 1}`, text: item.trim() }
        if (!item || typeof item !== "object") return null
        const record = item as Record<string, unknown>
        const text = String(record.text ?? record.caption ?? record.content ?? "").trim()
        return text ? { option: String(record.option ?? `Caption ${index + 1}`), text } : null
      })
      .filter((caption): caption is Caption => Boolean(caption?.text))
  } catch {
    return []
  }
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
        niche_features: input.niche_features ?? input.nicheFeatures ?? input.physicalFeatures ?? [],
        degen_scale: input.degen_scale ?? input.degenScale ?? 2,
        interactive_mode: interactiveMode,
        visual_context: input.visual_context ?? input.visualContext ?? "",
        content_type: input.content_type ?? input.contentType ?? "Picture",
        caption_mood: input.caption_mood ?? input.captionMood ?? "",
        creative_style: input.creativeStyle ?? "",
        subreddit_type: input.subreddit_type ?? input.subredditType ?? "",
        subreddit_name: input.subreddit_name ?? input.subredditName ?? "",
        rules: input.rules ?? "",
      }],
    }

    const systemInstruction = `${prompt.prompt_text.trim()}\n\n` +
      "API adapter: use the administrator instructions and every attached knowledge file as the generation source. " +
      "Return JSON only, using {\"caption_results\":[{\"option\":\"...\",\"text\":\"...\"}]}. " +
      "Do not include markdown, XML tags, reasoning, document excerpts, or any text outside that JSON object. " +
      "Follow the requested caption count from the administrator instructions; if they do not specify one, generate five."

    const payload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{
        role: "user",
        parts: [
          { text: "Read every attached knowledge file before producing the requested caption results." },
          ...knowledgeParts,
          { text: `<request_data>\n${JSON.stringify(requestData, null, 2)}\n</request_data>` },
        ],
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            caption_results: {
              type: "ARRAY",
              minItems: 1,
              maxItems: MAX_CAPTIONS,
              items: {
                type: "OBJECT",
                properties: {
                  option: { type: "STRING" },
                  text: { type: "STRING" },
                },
                required: ["option", "text"],
              },
            },
          },
          required: ["caption_results"],
        },
      },
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const errorText = await response.text()
      console.error("Caption Gemini API error:", response.status, errorText.slice(0, 1_000))
      return NextResponse.json({ error: "AI Generation Failed" }, { status: 502 })
    }

    const data = await response.json()
    const rawResponse = (data.candidates?.[0]?.content?.parts || [])
      .map((part: { text?: string }) => part.text || "")
      .join("")
      .trim()
    const captions = extractCaptions(rawResponse)
    if (!captions.length || captions.length > MAX_CAPTIONS) {
      console.error("Caption response did not contain usable caption_results", JSON.stringify(data).slice(0, 1_000))
      return NextResponse.json({ error: "AI Generation Failed" }, { status: 502 })
    }

    return NextResponse.json({
      captions,
      meta: {
        interactiveMode,
        model: GEMINI_MODEL,
        knowledgeDocuments: documents.length,
        promptSource: "admin",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    console.error("Caption generation error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}