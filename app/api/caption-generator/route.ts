export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

// ------------------ CONFIGURATION ------------------

const HF_API_KEY = process.env.AI_API_KEY ?? process.env.HF_API_KEY;

const API_URL =
  "https://router.huggingface.co/novita/v3/openai/chat/completions";

if (!HF_API_KEY) {
  console.error("❌ Missing Hugging Face API key (AI_API_KEY or HF_API_KEY in .env)");
}

// ------------------ KNOWLEDGE BASE (EMBEDDED) ------------------
// Strictly derived from Apex Logic (Source III) and Rulebook (Source II/IV).

const APEX_KNOWLEDGE_BASE = `
=== SOURCE I: FIREWALLS & COMPLIANCE ===
1. **Assumption Firewall:** You MUST NOT invent details (e.g., 'roommate', 'step dad', 'neighbor') unless explicitly stated in the User Input.
2. **Forbidden Phrases:** NEVER use: "smash or pass", "honest rating", "rate me 1-10", "do guys actually like...", "I hope...", "let me know in the comments"[cite: 26, 52].
3. **"Just" Constraint:** Captions MUST NOT start with the word "Just"[cite: 75].

=== SOURCE III: MASTER GENERATION PROTOCOLS ===
**MODE A: VARIETY PACK (Interactive Mode = OFF)** [cite: 59-60]
- **Goal:** Generate exactly 6 captions.
- **Archetype Requirements:**
  - **A1 (Curiosity Gap):** Hint at a result without clickbait. Do NOT invent hidden objects[cite: 5, 33].
  - **A2 (Authentic):** Casual, relatable, lower case vibe[cite: 7, 34].
  - **A4 (Niche Specificity):** MUST use specific adjectives from input (e.g., "goth", "toned", "petite")[cite: 8, 36].
  - **A5 (Situational/POV):** "When you..." or "POV:..." scenarios[cite: 9, 37].
  - **A6 (Compliment Bait):** False modesty or statement-based vulnerability[cite: 10, 38].
  - **A7 (Direct Descriptive):** Explicit description of the body/visuals using input tags[cite: 11, 39].

**MODE B: INTERACTIVE PACK (Interactive Mode = ON)** [cite: 61-62]
- **Goal:** Generate exactly 3 captions.
- **Archetype:** ONLY A3 (Interactive Questions).
- **Protocol:**
  - **Visual Consistency:** IF content_type == 'Picture', DO NOT use Binary Choice ("Front or Back?"). Use Validation ("Am I your type?")[cite: 64].
  - **Prefixes:** "Tell me...", "Curious..."[cite: 19].
`;

// ------------------ TYPES ------------------

type InteractiveMode = "ON" | "OFF";

interface ApexCaption {
  option: string;
  text: string;
}

// ------------------ UTILITIES ------------------

function enforceNoJustStart(text: string): string {
  if (!text) return "";
  // Remove leading "just" (any casing) at the very start
  const cleaned = text.replace(/^\s*just\b/i, "").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function sanitizeText(text: string): string {
  if (!text) return "";
  let clean = text.replace(/^["']|["']$/g, "").trim(); // strip outer quotes
  clean = clean.replace(/\\"/g, '"'); // unescape quotes
  return clean;
}

const FORBIDDEN_PATTERNS: RegExp[] = [
  /smash or pass/i,
  /honest rating/i,
  /rate me\s*1-10/i,
  /do guys actually like/i,
  /\bi hope\b/i,
  /let me know in the comments/i,
];

function filterForbiddenPhrases(text: string): string {
  if (!text) return "";
  let result = text;
  for (const pattern of FORBIDDEN_PATTERNS) {
    result = result.replace(pattern, "").trim();
  }
  return result;
}

function normalizeInteractiveMode(
  raw: unknown
): InteractiveMode {
  if (typeof raw === "boolean") {
    return raw ? "ON" : "OFF";
  }
  if (typeof raw === "string") {
    const upper = raw.toUpperCase().trim();
    if (upper === "ON") return "ON";
    if (upper === "OFF") return "OFF";
  }
  return "OFF";
}

// Safely extract an array of ApexCaption from a model response
function extractCaptions(rawResponse: string): ApexCaption[] {
  try {
    const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
    const cleanJson = jsonMatch
      ? jsonMatch[0]
      : rawResponse.replace(/```json|```/g, "").trim();

    let parsed: any = JSON.parse(cleanJson);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed.posts) {
      const firstPost = Array.isArray(parsed.posts)
        ? parsed.posts[0]
        : parsed.posts;
      if (firstPost?.captions && Array.isArray(firstPost.captions)) {
        return firstPost.captions;
      }
    }

    if (parsed.captions && Array.isArray(parsed.captions)) {
      return parsed.captions;
    }

    const firstArrayValue = Object.values(parsed).find((v) =>
      Array.isArray(v)
    );
    if (firstArrayValue && Array.isArray(firstArrayValue)) {
      return firstArrayValue as ApexCaption[];
    }

    // Fallback: wrap parsed as a single caption
    return [
      {
        option: "Raw Output",
        text: sanitizeText(rawResponse),
      },
    ];
  } catch (err) {
    console.error("❌ JSON Parse Error:", err);
    return [
      {
        option: "Raw Output",
        text: sanitizeText(rawResponse),
      },
    ];
  }
}

// Apply all final text constraints
function polishCaption(caption: any): ApexCaption {
  const baseText =
    caption?.text ??
    caption?.caption ??
    caption?.content ??
    "";

  let text = sanitizeText(baseText);
  text = enforceNoJustStart(text);
  text = filterForbiddenPhrases(text);

  return {
    option: caption?.option || "Apex Generated",
    text,
  };
}

// ------------------ MAIN API ROUTE ------------------

export async function POST(request: NextRequest) {
  console.log("\n⬇️ ====== APEX REQUEST START ======");

  try {
    if (!HF_API_KEY) {
      console.error("❌ Missing HF_API_KEY / AI_API_KEY – cannot call model.");
      return NextResponse.json(
        { error: "Server configuration error: missing AI API key." },
        { status: 500 }
      );
    }

    const token = request.headers
      .get("authorization")
      ?.replace("Bearer ", "");

    if (!token) {
      console.log("❌ Unauthorized Request");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    console.log("📦 User Input:", JSON.stringify(body, null, 2));

    // 1. Input Extraction & Normalization
    const gender = body.gender || "Female";
    const niche_features =
      body.niche_features ||
      body.nicheFeatures ||
      body.physicalFeatures ||
      "General";

    const visual_context =
      body.visual_context || body.visualContext || "General";

    const content_type = body.content_type || body.contentType || "Picture";
    const degen_scale = body.degen_scale || body.degenScale || "Suggestive";

    const interactive_mode = normalizeInteractiveMode(
      body.isInteractive ??
        body.interactive_mode ??
        body.interactiveMode
    );

    const caption_mood =
      body.captionMood || body.caption_mood || "";
    const subreddit_type =
      body.subredditType || body.subreddit_type || "";
    const subreddit_name =
      body.subredditName || body.subreddit_name || "";
    const extra_rules = body.rules || "";

    // 2. Construct Prompt with "Originality Mandate" + Style Alignment
    const systemPrompt = `
You are "Apex." Strictly follow the KNOWLEDGE BASE below.

=== KNOWLEDGE BASE ===
${APEX_KNOWLEDGE_BASE}
======================

=== USER INPUTS ===
- **Gender:** ${gender}
- **Visual Context:** "${visual_context}"
- **Niche/Features (MANDATORY USE):** "${niche_features}"
- **Content Type:** "${content_type}"
- **Degen Scale:** ${degen_scale}
- **Interactive Mode:** ${interactive_mode}
- **Caption Mood (Style Hint):** "${caption_mood || "neutral"}"
- **Creative Style:** "${body.creativeStyle || "default"}"
- **Subreddit Type:** "${subreddit_type || "generalist"}"
- **Subreddit Name (if any):** "${subreddit_name || "N/A"}"
- **User Rules / Notes:** "${extra_rules || "none"}"

=== ARCHETYPE RULES (STRICT) ===
You MUST obey these shape rules for each archetype:

- **A1 (Curiosity Gap):**
  - Must create a clear *information gap* around the visual.
  - Should hint at something about to happen without revealing it.
  - OPTIONAL: ending with "..." is allowed, but not required.
- **A2 (Authentic):**
  - First-person, casual, and grounded: "i", "me", "my".
  - Feels like a real thought or moment, not an ad.
  - Chill tone, not overly dramatic.
- **A4 (Niche Specificity):**
  - MUST include at least **2 adjectives** from "Niche/Features".
  - Should feel tailored to this body/type, not generic.
- **A5 (Situational/POV):**
  - Prefer starting with "POV:" or "When you...".
  - Must describe a concrete, visual scenario tied to the context.
- **A6 (Compliment Bait):**
  - Uses soft self-focus or playful confidence.
  - Implied validation-seeking (invites people to mentally react).
  - No explicit "rate me" or "be honest" style prompts.
- **A7 (Direct Descriptive):**
  - Densely descriptive: body, features, and context in one line.
  - Uses multiple adjectives and mentions the setting.

=== QUALITY CONTROL LOOP (MANDATORY) ===
For EACH caption you generate:

1. **INTERNALLY** rate it from **1 to 10** based on:
   - Archetype fit (does it clearly match its archetype definition?),
   - Click-through potential,
   - Clarity and naturalness of English,
   - Compliance with the firewall and forbidden phrases.

2. If your internal score is **below 8**, you MUST:
   - Rewrite and improve the caption,
   - Re-score it,
   - Repeat until you are satisfied it is **at least 8/10**.

3. You MUST NOT include your scores in the output.
   - Only output the final, improved captions.

=== PROTOCOL SELECTION ===
- IF Interactive Mode is **OFF**:
  - Generate exactly **6** captions:
    - One each: A1, A2, A4, A5, A6, A7.
- IF Interactive Mode is **ON**:
  - Generate exactly **3** captions:
    - All A3 (Interactive).
  - If Content Type is "Picture", you MUST NOT use Binary Choices
    (no "front or back?", "this or that?" style questions).
  - Use validation/fantasy questions instead.

=== NEGATIVE CONSTRAINTS (OVERRIDE ALL) ===
- NEVER use these or close variations:
  - "smash or pass"
  - "honest rating"
  - "rate me 1-10"
  - "do guys actually like..."
  - "I hope..."
  - "let me know in the comments"
- Captions MUST NOT start with the word "Just".
- Do NOT invent **social situations** or relationships not in the input:
  - No "roommate", "stepdad", "neighbor", etc. unless explicitly given.

=== OUTPUT FORMAT (MANDATORY) ===
Return ONLY a valid JSON array of objects. No markdown, no prose, no explanations.

Format exactly like:
[
  { "option": "A1 (Curiosity Gap)", "text": "..." },
  { "option": "A2 (Authentic)", "text": "..." }
]
`;


    console.log("🧠 System Prompt Constructed. Sending to AI...");

    // 3. Call Model (DeepSeek via HF Router)
    const payload = {
      model: "deepseek/deepseek-v3-0324",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate the captions now. Output ONLY JSON." },
      ],
      temperature: 0.7,
      stream: false,
      max_tokens: 1500,
    };

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Model API Error:", response.status, errorText);
      return NextResponse.json(
        { error: "AI Generation Failed" },
        { status: 500 }
      );
    }

    const data = await response.json();
    const rawResponse: string =
      data.choices?.[0]?.message?.content || "";

    console.log("🤖 Raw AI Response:", rawResponse);

    // 4. Robust Parsing & Cleaning
    const parsedCaptions = extractCaptions(rawResponse);

    // 5. Final Polish & Normalization
    let finalCaptions = parsedCaptions.map(polishCaption);

    // Hard-limit count based on mode (safety net)
    if (interactive_mode === "OFF" && finalCaptions.length > 6) {
      finalCaptions = finalCaptions.slice(0, 6);
    } else if (interactive_mode === "ON" && finalCaptions.length > 3) {
      finalCaptions = finalCaptions.slice(0, 3);
    }

    console.log("✅ Final Output:", JSON.stringify(finalCaptions, null, 2));
    console.log("⬆️ ====== APEX REQUEST END ======\n");

    return NextResponse.json({
      captions: finalCaptions,
      meta: {
        interactiveMode: interactive_mode,
        logic: "Apex Phase I-IV (DeepSeek)",
        model: "deepseek/deepseek-v3-0324",
      },
    });
  } catch (error: any) {
    console.error("❌ FATAL SERVER ERROR:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
