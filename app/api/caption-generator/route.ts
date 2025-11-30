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

  await Promise.all(files.map(async (file) => {
    const filePath = path.join(knowledgeDir, file);
    const ext = path.extname(file).toLowerCase();

    try {
      if (ext === ".pdf") {
        const buffer = fs.readFileSync(filePath);
        const data = await pdfParse(buffer);
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
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    
    // Robust Input Extraction
    const gender = body.gender || "Female";
    const niche_features = body.niche_features || body.nicheFeatures || body.physicalFeatures || "General";
    const visual_context = body.visual_context || body.visualContext || body.context || "General";
    const degen_scale = body.degen_scale || body.degenScale || "Suggestive";
    const interactive_mode = body.interactive_mode || body.interactiveMode || "OFF";
    const subreddit_name = body.subreddit_name || body.subredditName || "General";

    const knowledgeBase = await loadApexKnowledgeBase();
    if (!knowledgeBase || knowledgeBase.length < 100) {
      return NextResponse.json({ error: "Knowledge Base Empty." }, { status: 500 });
    }

    // ------------------ THE UPDATED PROMPT ------------------
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

=== EXECUTION PROTOCOL (STRICT) ===

**STEP 1: INFERENCE & ABSTRACTION**
- Apply "The Principle of Creative Abstraction": Do not just repeat the Visual Context.
- Example: If input is "Garden", think: "Neighbors, Sun, Grass, Fence, Outdoor, Risk".

**STEP 2: ARCHETYPE SELECTION (Optimization Matrix)**
- **IF Interactive Mode is OFF:** Generate 6 captions:
  - A1 (Curiosity Gap)
  - A2 (Authentic/Relatable)
  - A4 (Niche Specificity)
  - A5 (Situational / POV)
  - A6 (Compliment Bait - False Modesty)
  - A7 (Direct Descriptive)
- **IF Interactive Mode is ON:** Generate 3 captions using ONLY Archetype A3 (Interactive Questions).

**STEP 3: THE ORIGINALITY MANDATE**
- **Requirement:** At least 2 captions must mention specific features from "${niche_features}".
- **Requirement:** At least 2 captions must describe the context "${visual_context}".

**STEP 4: NEGATIVE CONSTRAINTS (INSTANT FAIL IF VIOLATED)**
1. **NO "HOPE":** You are FORBIDDEN from using "I hope...", "Hope you like...", or "Hopefully". These are defined as "Weak Phrases". Instead, use confident statements or commands (e.g., "Tell me I look good").
2. **NO ABSTRACT QUESTIONS:** You are FORBIDDEN from using abstract concepts like "worth the risk" or "risk it all". You must use "Concrete Language" (simple, physical actions or binary choices).
3. **NO "JUST":** Do NOT start any caption with the word "Just".
4. **NO GENERIC QUESTIONS:** Do NOT use "thoughts?" or "honest rating".

=== OUTPUT FORMAT ===
Return ONLY a JSON array of objects:
[
  { "option": "A1 (Curiosity Gap)", "text": "..." },
  { "option": "A2 (Authentic)", "text": "..." }
]
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7, 
      },
    });

    const result = await model.generateContent(systemPrompt);
    const rawResponse = result.response.text();

    let parsedCaptions = [];
    try {
      const cleanJson = rawResponse.replace(/```json|```/g, "").trim();
      parsedCaptions = JSON.parse(cleanJson);
      
      if (!Array.isArray(parsedCaptions) && parsedCaptions.posts) {
         parsedCaptions = parsedCaptions.posts[0]?.captions || []; 
      } else if (!Array.isArray(parsedCaptions)) {
         parsedCaptions = Object.values(parsedCaptions).flat();
      }
    } catch (e) {
      console.error("JSON Parse Error:", e);
      return NextResponse.json({ error: "AI Generation Failed" }, { status: 500 });
    }

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