import { NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

const API_KEY = process.env.GOOGLE_API_KEY ?? process.env.API_KEY
const genAI = new GoogleGenerativeAI(API_KEY || "")
const flashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

export async function POST(req: Request) {
  if (!API_KEY) {
    return NextResponse.json({ error: "Gemini API key is not configured." }, { status: 500 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const profile = body?.profile
  if (!profile || typeof profile !== "object") {
    return NextResponse.json({ error: "Missing or invalid profile payload." }, { status: 400 })
  }

  const prompt = `
You are a JSON-only assistant that normalizes creator profile settings for an NSFW subreddit analysis tool.

You will be given a raw creator profile with fields like:
- ethnicity, ethnicityOther
- bodyType, bodyTypeOther
- hairColor, hairColorOther
- ageBracket, ageBracketOther
- boobsType
- distinctiveFeatures
- hardLimits
- specialties
- collabSolo, collabBoyGirl, collabGirlGirl

Your job:
1. Interpret the profile and produce a concise normalized representation that captures the main attributes and tags that describe this creator.
2. Use "any" to mean "no restriction" on that dimension.
3. Include:
   - "filters": an object with normalized fields (ethnicity, bodyType, hairColor, ageVibe, boobsType) where each value is either a short canonical string or null if unconstrained.
   - "tags": an array of short keyword strings summarizing specialties, distinctive features, and general vibe.
   - "collabModes": an array of strings like "solo", "boy-girl", "girl-girl" depending on the booleans.
4. Consider all JSON fields provided. Do not ignore body type, hair, age vibe, boobsType, hardLimits, specialties, or collaboration fields.

Always respond with strict JSON only, no markdown, no extra text.

Raw profile JSON:
${JSON.stringify(profile, null, 2)}
`

  try {
    const result = await flashModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    })

    const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""

    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { normalizedProfile: { filters: {}, tags: [], collabModes: [] } }
    }

    const normalizedProfile = parsed.normalizedProfile ?? parsed

    return NextResponse.json({ normalizedProfile })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to call Gemini."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
