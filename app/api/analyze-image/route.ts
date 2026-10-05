import { type NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query } from "@/lib/db"
import { captionAccessForUser, CAPTION_PAUSED_MESSAGE } from "@/lib/caption-access"

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "")
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }
    if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0 || !(await captionAccessForUser(payload.userId)).allowed) {
      return NextResponse.json({ error: CAPTION_PAUSED_MESSAGE, code: "CAPTION_ACCESS_PAUSED", retryable: false }, { status: 403 })
    }

    const body = await request.json()
    const { imageData } = body

    if (!imageData) {
      return NextResponse.json({ error: "Missing image data" }, { status: 400 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in environment variables")
    }

    const matches = imageData.match(/^data:([A-Za-z-+/]+);base64,(.+)$/)
    if (!matches || matches.length !== 3) {
      return NextResponse.json({ error: "Invalid image data format" }, { status: 400 })
    }

    const mimeType = matches[1]
    const base64Data = matches[2]

    const promptResult = await query(
      "SELECT prompt_text FROM prompts WHERE name = ? ORDER BY created_at DESC LIMIT 1",
      ["image_analyzer"],
    )

    if (!promptResult || promptResult.length === 0) {
      throw new Error("Image analyzer prompt not found in database")
    }

    const storedPrompt = promptResult[0].prompt_text

    const fullPrompt = `<?xml version="1.0" encoding="UTF-8"?>
<image_analysis_task>
  <base_instructions>
${storedPrompt}
  </base_instructions>

  <output_format_requirements>
    <critical_instruction priority="highest">
      You MUST return your response as a VALID JSON object with this EXACT structure.
      Do NOT use XML, HTML, or any other format for the output.
      The prompt instructions above are in XML format for clarity, but your OUTPUT must be JSON.
    </critical_instruction>

    <required_json_structure>
{
  "contentType": "string (e.g., 'solo female', 'couple', 'group')",
  "setting": "string (e.g., 'bedroom', 'outdoor', 'bathroom')",
  "physicalAttributes": {
    "bodyType": "string",
    "hairColor": "string",
    "hairStyle": "string",
    "ethnicity": "string",
    "age": "string",
    "height": "string",
    "notableFeatures": ["array", "of", "strings"]
  },
  "clothing": {
    "outfit": "string",
    "color": "string",
    "style": "string",
    "accessories": ["array", "of", "strings"]
  },
  "pose": "string describing the pose/position",
  "mood": "string describing the mood/vibe",
  "lighting": "string describing lighting conditions",
  "cameraAngle": "string describing camera perspective",
  "visualElements": ["array", "of", "notable", "visual", "elements"],
  "suggestedSubreddits": ["array", "of", "subreddit", "names"],
  "nsfwLevel": "string (mild/moderate/explicit)",
  "tags": ["array", "of", "relevant", "tags"]
}
    </required_json_structure>

    <mandatory_rules>
      <rule>Return ONLY the JSON object, no markdown code blocks, no explanations</rule>
      <rule>Do NOT wrap in \`\`\`json or any other formatting</rule>
      <rule>All string values must be properly escaped</rule>
      <rule>Arrays must contain at least one item</rule>
      <rule>The response must be parseable by JSON.parse()</rule>
    </mandatory_rules>
  </output_format_requirements>
</image_analysis_task>`

    console.log("\n\n=== PROMPT SENT TO AI ===")
    console.log(fullPrompt)
    console.log("=== END PROMPT ===\n\n")

    const documentsResult = await query(
      `SELECT d.filename, d.cloudinary_url, d.file_type 
       FROM documents d 
       JOIN prompts p ON d.prompt_id = p.id 
       WHERE p.name = ? 
       ORDER BY d.created_at DESC`,
      ["image_analyzer"],
    )

    const parts: any[] = [
      { text: fullPrompt },
      {
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      },
    ]

    if (documentsResult && documentsResult.length > 0) {
      console.log(`Found ${documentsResult.length} knowledge base document(s)`)

      for (const doc of documentsResult) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000)

          const docResponse = await fetch(doc.cloudinary_url, {
            signal: controller.signal,
          })

          clearTimeout(timeoutId)

          if (docResponse.ok) {
            const docBuffer = await docResponse.arrayBuffer()
            const base64Doc = Buffer.from(docBuffer).toString("base64")

            parts.push({
              inline_data: {
                mime_type: doc.file_type,
                data: base64Doc,
              },
            })
            console.log(`Successfully loaded document: ${doc.filename}`)
          } else {
            console.warn(`Failed to fetch document: ${doc.cloudinary_url}, status: ${docResponse.status}`)
          }
        } catch (docError: unknown) {
          const errorMessage = docError instanceof Error ? docError.message : "Unknown error"
          console.warn(`Error fetching document ${doc.filename}: ${errorMessage}`)
        }
      }
    } else {
      console.log("No knowledge base documents found")
    }

    console.log("Sending request to Gemini API")
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
        }),
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      console.error("Gemini API request failed:", JSON.stringify(errorData))
      throw new Error(`Gemini API error: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    console.log("Received response from Gemini API")
    const data = await response.json()

    console.log("\n\n=== RESPONSE RECEIVED FROM AI ===")
    console.log(JSON.stringify(data, null, 2))
    console.log("=== END RESPONSE ===\n\n")

    if (data.promptFeedback?.blockReason) {
      console.error("Content blocked by Gemini API:", data.promptFeedback.blockReason)
      throw new Error(`Content was blocked: ${data.promptFeedback.blockReason}`)
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error("No content returned from Gemini API")
      throw new Error("No content returned from Gemini API")
    }

    let analysis
    try {
      analysis = JSON.parse(text)
      console.log("Successfully parsed JSON response")
    } catch (error: unknown) {
      const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
      if (codeBlockMatch) {
        try {
          analysis = JSON.parse(codeBlockMatch[1])
          console.log("Successfully parsed JSON from code block")
        } catch (e: unknown) {
          console.error("AI returned JSON in code block but it's malformed")
          throw new Error("AI returned malformed JSON")
        }
      } else {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          console.error("AI response doesn't contain valid JSON:", text.substring(0, 500))
          throw new Error("AI did not return valid JSON format")
        }
        try {
          analysis = JSON.parse(jsonMatch[0])
          console.log("Successfully extracted and parsed JSON")
        } catch (e: unknown) {
          console.error("Found JSON-like content but failed to parse")
          throw new Error("Failed to parse AI response")
        }
      }
    }

    console.log("Image analysis completed successfully")
    return NextResponse.json({ analysis })
  } catch (error: unknown) {
    console.error("Error analyzing image:", error)
    const errorMessage = error instanceof Error ? error.message : "Failed to analyze image"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
