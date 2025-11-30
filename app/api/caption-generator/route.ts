export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ------------------ CONFIGURATION ------------------

const API_KEY = process.env.GOOGLE_API_KEY ?? process.env.API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY || "");

// ------------------ KNOWLEDGE BASE LOADER ------------------

async function loadApexKnowledgeBase(): Promise<string> {
  const knowledgeDir = path.join(process.cwd(), "knowledge");
  
  if (!fs.existsSync(knowledgeDir)) {
    console.error("❌ 'knowledge' directory MISSING at project root.");
    return "";
  }

  const files = fs.readdirSync(knowledgeDir);
  const documents: string[] = [];

  console.log(`📚 Loading Apex Brain from ${files.length} files...`);

  await Promise.all(files.map(async (file) => {
    const filePath = path.join(knowledgeDir, file);
    const ext = path.extname(file).toLowerCase();

    try {
      if (ext === ".pdf") {
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
        // Clean excessive whitespace to help the AI read faster
        const cleanText = data.text.replace(/\n\s*\n/g, "\n"); 
        documents.push(`\n\n=== SOURCE DOCUMENT: ${file} ===\n${cleanText}\n`);
      } 
      else if ([".txt", ".md", ".json", ".xml"].includes(ext)) {
        const content = fs.readFileSync(filePath, "utf-8");
        documents.push(`\n\n=== SOURCE DOCUMENT: ${file} ===\n${content}\n`);
      }
    } catch (err) {
      console.error(`❌ Error reading ${file}:`, err);
    }
  }));

  return documents.join("\n");
}

// ------------------ UTILITIES ------------------

// Enforces Rule: Captions MUST NOT start with "Just".
function enforceNoJustStart(text: string): string {
  if (!text) return "";
  const cleaned = text.replace(/^\s*just\b/i, "").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function sanitizeText(text: string): string {
  if (!text) return "";
  return text.replace(/"/g, "'").trim();
}

// ------------------ MAIN API ROUTE ------------------

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 2. Robust Input Extraction (Handles snake_case AND camelCase)
    const body = await request.json();
    console.log("📥 Received Inputs:", JSON.stringify(body, null, 2));

    const gender = body.gender || "Female";
    // Check multiple variations to ensure we never get a blank input
    const niche_features = body.niche_features || body.nicheFeatures || body.physicalFeatures || "General";
    const visual_context = body.visual_context || body.visualContext || body.context || "General";
    const degen_scale = body.degen_scale || body.degenScale || "Suggestive";
    const interactive_mode = body.interactive_mode || body.interactiveMode || "OFF";
    const subreddit_name = body.subreddit_name || body.subredditName || "General";

    // 3. Load Knowledge
    const knowledgeBase = await loadApexKnowledgeBase();
    if (!knowledgeBase || knowledgeBase.length < 100) {
      return NextResponse.json({ error: "Knowledge Base Empty." }, { status: 500 });
    }

    // 4. Construct the "Apex" Prompt
    // This prompt forces the AI to use specific sections of your PDFs.
    const systemPrompt = `
You are "Apex," an expert caption generation engine. 
You must strictly follow the "Apex Logic" (Phase I-IV) attached below.

=== KNOWLEDGE BASE ===
${knowledgeBase}
======================

=== USER INPUTS ===
- **Gender:** ${gender}
- **Visual Context:** "${visual_context}"
- **Niche/Features:** "${niche_features}"
- **Degen Scale:** ${degen_scale}
- **Interactive Mode:** ${interactive_mode}
- **Target Subreddit:** ${subreddit_name}

=== EXECUTION PROTOCOL (STRICT) ===

**STEP 1: INFERENCE & ABSTRACTION**
- Apply "The Principle of Creative Abstraction": Do not just repeat the Visual Context.
- Example: If input is "Garden", think: "Neighbors, Sun, Grass, Fence, Outdoor, Risk".
- Example: If input is "Bedroom", think: "Sheets, Morning, Lazy, Private".

**STEP 2: ARCHETYPE SELECTION (Optimization Matrix)**
- **IF Interactive Mode is OFF:** You MUST generate 6 captions using the Standard Variety Mix:
  - A1 (Curiosity Gap)
  - A2 (Authentic/Relatable)
  - A4 (Niche Specificity)
  - A5 (Situational / POV)
  - A6 (Compliment Bait - False Modesty)
  - A7 (Direct Descriptive)
- **IF Interactive Mode is ON:** Generate 3 captions using ONLY Archetype A3 (Interactive Questions).

**STEP 3: THE ORIGINALITY MANDATE**
- You MUST physically insert the User Inputs into the captions.
- **Requirement:** At least 2 captions must mention specific features from "${niche_features}".
- **Requirement:** At least 2 captions must describe the context "${visual_context}".
- **Prohibition:** Do NOT generate generic text like "Feeling cute" or "What do you think?".

**STEP 4: FORMATTING RULES**
- **Rule:** Do NOT start any caption with the word "Just".
- **Rule:** Do NOT use forbidden phrases like "honest rating".
- **Rule:** Return ONLY a JSON array.

=== OUTPUT FORMAT ===
Return strictly a JSON array of objects:
[
  { "option": "A1 (Curiosity Gap)", "text": "..." },
  { "option": "A2 (Authentic)", "text": "..." }
]
`;

    // 5. Generate with Gemini
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        responseMimeType: "application/json",
        // Lower temperature ensures it follows the Rules strictly
        temperature: 0.65, 
      },
    });

    console.log("⚡ Sending strictly engineered prompt to Gemini...");
    const result = await model.generateContent(systemPrompt);
    const rawResponse = result.response.text();
    console.log("🟣 Gemini Response:", rawResponse);

    // 6. Parse Response
    let parsedCaptions = [];
    try {
      const cleanJson = rawResponse.replace(/```json|```/g, "").trim();
      parsedCaptions = JSON.parse(cleanJson);
      
      // Handle "posts" wrapper if AI adds it
      if (!Array.isArray(parsedCaptions) && parsedCaptions.posts) {
         parsedCaptions = parsedCaptions.posts[0]?.captions || []; 
      } else if (!Array.isArray(parsedCaptions)) {
         parsedCaptions = Object.values(parsedCaptions).flat();
      }
    } catch (e) {
      console.error("JSON Parse Error:", e);
      return NextResponse.json({ error: "AI Generation Failed" }, { status: 500 });
    }

    // 7. Sanitize (Double check the "Just" rule)
    const finalCaptions = Array.isArray(parsedCaptions) ? parsedCaptions.map((c: any) => ({
      option: c.option || "Apex Generated",
      text: enforceNoJustStart(sanitizeText(c.text))
    })) : [];

    return NextResponse.json({
      captions: finalCaptions,
      meta: {
        mode: interactive_mode,
        logic: "Apex Phase I-IV"
      }
    });

  } catch (error: any) {
    console.error("❌ FATAL ERROR:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}