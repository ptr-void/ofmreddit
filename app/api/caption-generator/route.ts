// app/api/caption-generator/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";

const PROJECT_ID = process.env.VERTEX_PROJECT_ID!;
const LOCATION = process.env.VERTEX_LOCATION || "us-central1";
const API_KEY = process.env.VERTEX_API_KEY!;

const GEMINI_ENDPOINT = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash:generateContent`;

const DOCUMENT_URLS = [
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760423100/admin-documents/I",
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760423139/admin-documents/IV",
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760423141/admin-documents/III",
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760435485/admin-documents/II",
];

type FullDoc = { name: string; content: string };
let docs: FullDoc[] = [];

async function loadDocs() {
  if (docs.length === 4) return;
  docs = [];
  for (let i = 0; i < DOCUMENT_URLS.length; i++) {
    const url = DOCUMENT_URLS[i];
    const name = `Document_${i + 1}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "CaptionBot/1.0" } });
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      const { text } = await pdfParse(buffer);
      const clean = text.trim();
      if (clean.length > 500 && !clean.includes("nnit")) {
        docs.push({ name, content: clean });
        console.log(`${name} loaded – ${clean.length} chars`);
      }
    } catch {}
  }
}

// STAGE 1: Research Assistant – finds the perfect pages
async function getRelevantGuidelines(params: any): Promise<string> {
  await loadDocs();
  if (!docs.length) return "No guidelines loaded.";

  const userParamsBlock = `
USER PARAMETERS:
- Mode: ${params.mode || "N/A"}
- Gender: ${params.gender || "N/A"}
- Physical Features: ${params.physicalFeatures || "N/A"}
- Subreddit: ${params.subredditName || "N/A"} (${params.subredditType || "N/A"})
- Visual Context: ${params.visualContext || "N/A"}
- Content Type: ${params.contentType || "picture"}
- Mood: ${params.captionMood || "seductive"}
- Creative Style: ${params.creativeStyle || "N/A"}
- Degen Scale: ${params.degenScale ?? "N/A"}
- Clickbait/Interactive: ${params.isInteractive ? "yes" : "no"}
- Specific Rules: ${params.rules || "None"}
`.trim();

  const prompt = `You are an elite research assistant.
Here are the full caption guidelines (4 documents):

${docs.map(d => `=== ${d.name} ===\n${d.content}`).join("\n\n")}

${userParamsBlock}

Your ONLY job: Find and return the 2–4 MOST RELEVANT sections from the documents above that match this user request.
Return exactly this format:

=== RELEVANT SECTIONS ===
Document: Document_3
Section: [paste the exact paragraph or example that fits best]

Document: Document_2
Section: [another perfect match]
=== END ===

Do NOT summarize. Do NOT add commentary. Only return the most relevant raw excerpts.`;

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.0, maxOutputTokens: 2048 },
    }),
  });

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log("\nRESEARCH ASSISTANT OUTPUT:\n", raw);

  const match = raw.match(/=== RELEVANT SECTIONS ===([\s\S]*?)=== END ===/);
  return match ? match[1].trim() : "No highly relevant sections found.";
}

// STAGE 2: Final Caption Writer
async function generateCaptions(params: any, guidelines: string) {
  const userParamsBlock = `
USER PARAMETERS:
- Mode: ${params.mode || "N/A"}
- Gender: ${params.gender || "N/A"}
- Physical Features: ${params.physicalFeatures || "N/A"}
- Subreddit: ${params.subredditName || "N/A"} (${params.subredditType || "N/A"})
- Visual Context: ${params.visualContext || "N/A"}
- Content Type: ${params.contentType || "picture"}
- Mood: ${params.captionMood || "seductive"}
- Creative Style: ${params.creativeStyle || "N/A"}
- Degen Scale: ${params.degenScale ?? "N/A"}
- Clickbait/Interactive: ${params.isInteractive ? "yes" : "no"}
- Specific Rules: ${params.rules || "None"}
`.trim();

  const prompt = `You are the world's best Reddit caption writer.

${userParamsBlock}

RELEVANT GUIDELINES FROM DOCS (follow these 100%):
${guidelines || "No specific guidelines — be very creative."}

RULES:
- Generate EXACTLY 5 captions
- Gender must be ${params.gender?.toUpperCase()}
- Location/scene: ${params.visualContext || "beautiful setting"}
- Creative style: ${params.creativeStyle || "seductive"}
- Degen level ${params.degenScale}: be playful-suggestive (2) or very naughty (3)
- NEVER mention gym, fitness, workout, sweat, pump, cardio unless user explicitly says it
- NEVER start a caption with "just"
- If Clickbait/Interactive = yes → use questions or swipe prompts
- Return ONLY valid JSON array, nothing else

Format:
[{"option":"Option 1","text":"caption here"},{"option":"Option 2","text":"..."}]`; 

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.88,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!res.ok) throw new Error("Gemini failed");

  const data = await res.json();
  let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  raw = raw.replace(/```json|```/g, "").trim();

  let parsed = [];
  try { parsed = JSON.parse(raw);
  } catch { console.log("JSON parse failed"); }

  return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
}

export async function POST(req: NextRequest) {
  console.log("\nTWO-STAGE RAG STARTED\n");

  try {
    const {
      mode,
      physicalFeatures,
      gender,
      subredditType,
      visualContext,
      degenScale,
      captionMood,
      rules,
      creativeStyle,
      isInteractive,
      contentType,
      subredditName,
      captionCount = 5,
      files,
    } = await req.json();

    console.log("FULL USER INPUT:", { mode, gender, physicalFeatures, visualContext, creativeStyle, degenScale, isInteractive, subredditName, subredditType });

    const relevant = await getRelevantGuidelines({ mode, gender, physicalFeatures, subredditName, subredditType, visualContext, contentType, captionMood, creativeStyle, degenScale, isInteractive, rules });

    const captions = await generateCaptions({ mode, gender, physicalFeatures, subredditName, subredditType, visualContext, contentType, captionMood, creativeStyle, degenScale, isInteractive, rules, captionCount }, relevant);

    const finalCaptions = captions.map((c: any, i: number) => ({
      option: c.option || `Option ${i + 1}`,
      text: (c.text || "").replace(/^just\s+/i, "").trim() || "Hey there...",
    }));

    console.log("\nFINAL CAPTIONS:");
    finalCaptions.forEach((c: any) => console.log(`• ${c.text}`));

    return NextResponse.json({ captions: finalCaptions });
  } catch (e: any) {
    console.error("ERROR:", e.message);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}