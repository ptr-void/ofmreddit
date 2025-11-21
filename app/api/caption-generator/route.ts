export const runtime = "nodejs"; // ensure Node runtime on Vercel
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { pipeline } from "@xenova/transformers";

// ------------------ ENV + GEMINI ------------------

const API_KEY = process.env.GOOGLE_API_KEY ?? process.env.API_KEY;
if (!API_KEY) {
  console.warn("❌ Missing GOOGLE_API_KEY / API_KEY env var for Gemini.");
}

const genAI = new GoogleGenerativeAI(API_KEY || "");

// ------------------ LOCAL EMBEDDING PIPELINE ------------------

let embeddingPipelinePromise: Promise<any> | null = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    console.log("🔧 Loading local embedding model (all-MiniLM-L6-v2)...");
    embeddingPipelinePromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }
  return embeddingPipelinePromise;
}

async function embedText(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  // output.data is a typed array
  return Array.from(output.data as Float32Array);
}

// ------------------ UTILS ------------------

function sanitizeText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function enforceNoJustStart(text: string): string {
  if (/^\s*just\b/i.test(text)) {
    text = text.replace(/^\s*just\b/i, "").trim();
  }
  return text || "Here I am — say something nice.";
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function chunkText(text: string, chunkSize = 800, overlap = 200): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks;
}

// ------------------ DOCUMENT RAG INDEX ------------------

type VectorChunk = {
  id: string;
  docName: string;
  sourceUrl: string;
  text: string;
  embedding: number[];
};

let vectorIndex: VectorChunk[] | null = null;
let indexBuildingPromise: Promise<void> | null = null;

const documentUrls = [
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760423100/admin-documents/I",
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760423139/admin-documents/IV",
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760423141/admin-documents/III",
  "https://res.cloudinary.com/defkzzqcs/raw/upload/v1760435485/admin-documents/II",
];

async function buildVectorIndex() {
  console.log("📚 Building vector index from Cloudinary PDFs...");

  const chunks: VectorChunk[] = [];

  for (let i = 0; i < documentUrls.length; i++) {
    const url = documentUrls[i];
    const docName = `Document_${i + 1}`;
    console.log(`📥 Fetching PDF ${docName} from: ${url}`);

    try {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`📝 Extracting text from ${docName}...`);
      const data = await pdfParse(buffer);
      const fullText = (data.text || "").trim();

      console.log(
        `🔍 ${docName} text length: ${fullText.length}, preview:`,
        fullText.substring(0, 300)
      );

      if (!fullText) continue;

      const textChunks = chunkText(fullText, 800, 200);
      console.log(`✂️ ${docName} split into ${textChunks.length} chunks.`);

      for (let j = 0; j < textChunks.length; j++) {
        const chunkTextValue = textChunks[j];
        const id = `${docName}_chunk_${j + 1}`;

        const embedding = await embedText(chunkTextValue);

        chunks.push({
          id,
          docName,
          sourceUrl: url,
          text: chunkTextValue,
          embedding,
        });
      }
    } catch (err) {
      console.error(`❌ Failed processing ${docName}`, err);
    }
  }

  vectorIndex = chunks;
  console.log(`✅ Vector index built with ${chunks.length} chunks.`);
}

async function ensureVectorIndex() {
  if (vectorIndex) return;
  if (!indexBuildingPromise) {
    indexBuildingPromise = buildVectorIndex();
  }
  await indexBuildingPromise;
}

async function retrieveRelevantChunks(
  query: string,
  topK = 6
): Promise<VectorChunk[]> {
  await ensureVectorIndex();
  if (!vectorIndex || vectorIndex.length === 0) {
    console.warn("⚠️ Vector index is empty. No documents available.");
    return [];
  }

  console.log("🔎 Embedding query for vector search...");
  const queryEmbedding = await embedText(query);

  const scored = vectorIndex.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, topK).map((s) => s.chunk);

  console.log(
    "🏆 Top chunks selected:",
    top.map((c) => ({
      id: c.id,
      doc: c.docName,
      scoreApprox: "see logs", // we’re not returning raw floats
    }))
  );

  return top;
}

// ------------------ MAIN ROUTE ------------------

export async function POST(request: NextRequest) {
  try {
    console.log("\n=====================================");
    console.log("🔥 NEW CAPTION REQUEST (LOCAL RAG)");
    console.log("=====================================\n");

    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      console.log("❌ No token provided");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("🟢 BODY:", body);

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
      captionCount: rawCaptionCount,
      files,
    } = body;

    if (!mode || !gender) {
      return NextResponse.json(
        { error: "Missing required fields: mode and gender are required" },
        { status: 400 }
      );
    }

    const captionCount =
      typeof rawCaptionCount === "number" && rawCaptionCount >= 1 && rawCaptionCount <= 20
        ? rawCaptionCount
        : 5;

    const fileAttachmentInfo = {
      hasFiles: Array.isArray(files) && files.length > 0,
      files: Array.isArray(files) ? files : [],
    };

    console.log("📎 FILE ATTACHMENT DETECTION:", fileAttachmentInfo);

    // ---------- RAG QUERY STRING ----------
    const queryForRag = `
Mode: ${mode}
Gender: ${gender}
Physical Features: ${physicalFeatures || "not specified"}
Subreddit: ${subredditName || "not specified"}
Subreddit Type: ${subredditType || "not specified"}
Visual Context: ${visualContext || "not specified"}
Caption Mood: ${captionMood || "seductive"}
Creative Style: ${creativeStyle || "not specified"}
Degen Scale: ${degenScale ?? "not specified"}
`;

    console.log("🧠 RAG QUERY STRING:\n", queryForRag);

    // ---------- VECTOR SEARCH ----------
    const topChunks = await retrieveRelevantChunks(queryForRag, 6);

    const knowledgeBase = topChunks
      .map(
        (c, idx) => `
[DOC ${idx + 1} | ${c.docName}]
Source: ${c.sourceUrl}

${c.text}
`
      )
      .join("\n\n");

    console.log("\n📚 KNOWLEDGE BASE PASSED TO GEMINI:\n", knowledgeBase);

    const clickbaitStyle = isInteractive ? "y" : "n";

    // ---------- PROMPT ----------
    const prompt = `
You are an expert Reddit caption generator using a custom RAG system.

You are given:
1) A KNOWLEDGE BASE from internal documents (Project Apex guidelines, rules, examples).
2) USER INPUT with photo context and preferences.

You MUST:
- Generate EXACTLY ${captionCount} captions.
- Never start any caption with the word "just".
- Match the style, tone, and constraints implied by the KNOWLEDGE BASE.
- Return ONLY a JSON array, nothing else.

KNOWLEDGE BASE:
${knowledgeBase || "[NO DOCUMENTS AVAILABLE - fall back to general rules]"}

USER INPUT:
- Mode: ${mode}
- Gender: ${gender}
- Physical Features: ${physicalFeatures || "not specified"}
- Subreddit Name: ${subredditName || "not specified"}
- Subreddit Type: ${subredditType || "not specified"}
- Visual Context: ${visualContext || "not specified"}
- Content Type: ${contentType || "picture"}
- Caption Mood: ${captionMood || "seductive"}
- Creative Style: ${creativeStyle || "not specified"}
- Degen Scale: ${degenScale ?? "not specified"}
- Clickbait Style: ${clickbaitStyle}
- Subreddit Rules: ${rules || "none specified"}
- Files Attached: ${fileAttachmentInfo.hasFiles ? fileAttachmentInfo.files.join(", ") : "none"}

RESPONSE FORMAT (CRITICAL):
Return ONLY a JSON array:
[
  { "option": "Option 1", "text": "..." },
  { "option": "Option 2", "text": "..." }
]

Number of items in the array MUST be exactly ${captionCount}.
`;

    console.log("\n📝 PROMPT SENT TO GEMINI:\n", prompt);

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
    });

    let attempt = 0;
    let captions: { option: string; text: string }[] = [];
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        console.log(`⚡ GEMINI ATTEMPT ${attempt + 1}...`);

        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  option: { type: SchemaType.STRING },
                  text: { type: SchemaType.STRING },
                },
                required: ["option", "text"],
              },
              minItems: captionCount,
              maxItems: captionCount,
            },
            maxOutputTokens: 2048,
            temperature: 0.7,
          },
        });

        let raw = result.response.text();
        console.log("\n🟣 RAW GEMINI RESPONSE:\n", raw);

        if (raw.startsWith("```")) {
          raw = raw.replace(/^```[\w]*\s*|\s*```$/g, "").trim();
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          throw new Error("Model did not return a JSON array");
        }

        captions = parsed.map((c: any, idx: number) => ({
          option: c.option || `Option ${idx + 1}`,
          text: sanitizeText(enforceNoJustStart(c.text || "")),
        }));

        if (captions.length !== captionCount) {
          throw new Error(
            `Expected ${captionCount} captions, got ${captions.length}`
          );
        }

        break;
      } catch (err) {
        console.error(`❌ Attempt ${attempt + 1} failed:`, err);
        attempt++;
        if (attempt >= maxAttempts) {
          throw err;
        }
      }
    }

    console.log("\n✅ FINAL CAPTIONS SENT TO CLIENT:\n", captions);

    return NextResponse.json(
      {
        captions,
        ragDebug: {
          usedChunks: topChunks.map((c) => ({
            id: c.id,
            docName: c.docName,
            sourceUrl: c.sourceUrl,
            preview: c.text.substring(0, 200),
          })),
          prompt,
        },
        filesAttached: fileAttachmentInfo.hasFiles,
        attachedFiles: fileAttachmentInfo.files,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("❌ FATAL ERROR:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
