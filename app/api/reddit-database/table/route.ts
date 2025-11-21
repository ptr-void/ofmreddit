import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

type SheetData = {
  title: string
  headers: string[]
  rows: string[][]
}

const API_KEY = process.env.GOOGLE_API_KEY ?? process.env.API_KEY

if (!API_KEY) {
  console.warn("Missing GOOGLE_API_KEY / API_KEY env var for Gemini.")
}

const genAI = new GoogleGenerativeAI(API_KEY || "")

const flashModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
})

function isDefaultProfile(profile: any): boolean {
  if (!profile || typeof profile !== "object") return true
  const textEmpty = (v: any) => (v ?? "").toString().trim() === ""
  return (
    profile.ethnicity === "any" &&
    profile.bodyType === "any" &&
    profile.hairColor === "any" &&
    profile.ageBracket === "any" &&
    profile.boobsType === "any" &&
    textEmpty(profile.distinctiveFeatures) &&
    textEmpty(profile.hardLimits) &&
    textEmpty(profile.specialties) &&
    profile.collabSolo === false &&
    profile.collabBoyGirl === false &&
    profile.collabGirlGirl === false &&
    textEmpty(profile.ethnicityOther) &&
    textEmpty(profile.bodyTypeOther) &&
    textEmpty(profile.hairColorOther) &&
    textEmpty(profile.ageBracketOther)
  )
}

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const sheetData: SheetData | null = body?.sheetData ?? null
  const profile = body?.profile
  const normalizedProfile = body?.normalizedProfile

  if (!sheetData || !Array.isArray(sheetData.headers) || !Array.isArray(sheetData.rows)) {
    return NextResponse.json({ error: "Invalid or missing sheetData." }, { status: 400 })
  }

  if (isDefaultProfile(profile)) {
    return NextResponse.json(sheetData)
  }

  const prompt = `
You are an assistant helping filter NSFW subreddits for a specific creator profile.

You receive:
1) A raw creator profile.
2) A normalized creator profile.
3) A table of subreddits: headers and rows.

Each row in "rows" corresponds to one subreddit. The entire row (all columns) may contain useful signals such as:
- Explicit ethnicity focus (e.g. black, ebony, latina, asian, white)
- Body type focus (e.g. bbw, petite, slim, curvy)
- Age vibe (e.g. milf, teen-looking 18+, mature, college)
- Hair or visual tags
- Boobs type, content themes, collaboration style, etc.

Your task:
For each row index, decide if this subreddit is a good match for the creator profile.

Rules:
- Use all information in the raw and normalized profile JSON: ethnicity, body type, hair color, age vibe, boobsType, distinctive features, hard limits, specialties, and collaboration willingness.
- If the subreddit clearly targets a different, incompatible ethnicity/body type/age vibe than the creator, mark it as excluded.
- If the subreddit obviously conflicts with the creator's hard limits or is focused on content they will not do, exclude it.
- If the subreddit is generic and not obviously restricted (e.g. "bootypetite", "OnlyFansGirls", "petitegonewild"), it can be included for any compatible creator.
- Consider collaboration preferences when clearly relevant (e.g. subs that are only for couples content vs solo content).

Output format:

Return plain text only.
Each line must have the format:

index,include

Where:
- index is the numeric index of the row in the "rows" array (0-based).
- include is 1 if that row should be included, or 0 if it should be excluded.

Examples of valid output:

0,1
1,0
2,1

Do not return JSON.
Do not return markdown.
Do not return any explanations or extra text.
Only lines in the exact "index,include" format.

Raw creator profile:
${JSON.stringify(profile, null, 2)}

Normalized creator profile:
${JSON.stringify(normalizedProfile, null, 2)}

Headers:
${JSON.stringify(sheetData.headers)}

Rows:
${JSON.stringify(sheetData.rows)}
`.trim()

  try {
    const result = await flashModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    })

    const text = result.response.text()

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    const decisionMap = new Map<number, boolean>()

    for (const line of lines) {
      const match = line.match(/^(\d+)\s*[,;:]\s*(1|0|true|false)\b/i)
      if (!match) continue
      const index = Number(match[1])
      if (!Number.isFinite(index)) continue
      const includeToken = match[2].toLowerCase()
      const include = includeToken === "1" || includeToken === "true"
      decisionMap.set(index, include)
    }

    if (!decisionMap.size) {
      return NextResponse.json(sheetData)
    }

    const filteredRows = sheetData.rows.filter((_, index) => {
      if (!decisionMap.has(index)) return true
      return decisionMap.get(index) === true
    })

    const resultSheet: SheetData = {
      title: sheetData.title,
      headers: sheetData.headers,
      rows: filteredRows,
    }

    return NextResponse.json(resultSheet)
  } catch {
    return NextResponse.json(sheetData)
  }
}
