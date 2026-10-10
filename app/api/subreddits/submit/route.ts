import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { validateNicheTags } from "@/lib/niche-presets"
import { getRedditAccessToken } from "@/lib/reddit-oauth"
import { createWorkbookReader, parseSpreadsheetUrl } from "@/lib/google-sheets-reader"
import { subredditKey } from "@/lib/reddit-database-display"
import { queueSubredditSubmission } from "@/lib/subreddit-submission-store"
import { MAX_SUBREDDIT_INPUT_LENGTH, SUBMISSION_BATCH_SIZE, parseSubredditList, type SubmissionResult } from "@/lib/subreddit-submissions"

export const maxDuration = 60

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  const user = token ? verifyToken(token) : null
  if (!user?.userId) return NextResponse.json({ error: "Sign in before submitting subreddits" }, { status: 401 })
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid submission request" }, { status: 400 })
  }
  const input = body?.subreddits ?? body?.subreddit
  if (!(typeof input === "string" || (Array.isArray(input) && input.every(value => typeof value === "string")))) {
    return NextResponse.json({ error: "Paste subreddit names or Reddit links" }, { status: 400 })
  }
  if ((Array.isArray(input) ? input.join("\n") : input).length > MAX_SUBREDDIT_INPUT_LENGTH) {
    return NextResponse.json({ error: "The pasted list is too long" }, { status: 400 })
  }
  const { items, duplicates } = parseSubredditList(input)
  if (!items.length || items.length > SUBMISSION_BATCH_SIZE) {
    return NextResponse.json({ error: `Send between 1 and ${SUBMISSION_BATCH_SIZE} unique subreddits per request` }, { status: 400 })
  }
  try {
    const niche = await validateNicheTags(body.tags)
    if (!niche.ok) return NextResponse.json({ error: niche.error }, { status: 400 })
    // Curated Sheet rows are authoritative; not every row has a DB mirror.
    const parsed = parseSpreadsheetUrl(process.env.SUBREDDIT_SHEET_URL || "")
    if (!parsed) throw new Error("Subreddit table is not configured")
    const sheet = await (await createWorkbookReader(parsed.spreadsheetId)).readByGid(parsed.gid)
    const identity = sheet.headers.findIndex(header => /^(subreddit|subreddit name)$/i.test(header.trim()))
    const link = sheet.headers.findIndex(header => header.trim().toLowerCase() === "link")
    const status = sheet.headers.findIndex(header => header.trim().toLowerCase() === "sync status")
    if (identity < 0 && link < 0) throw new Error("Subreddit table identity column is missing")
    const known = new Set(sheet.rows.filter(row => String(row[status] || "").toLowerCase().trim() !== "archived")
      .map(row => subredditKey(String(row[identity] || row[link] || ""))).filter(Boolean))
    let accessToken: string | null = null
    let tokenFailed = false
    const results: SubmissionResult[] = []
    // Small sequential batches bound OAuth traffic and serverless duration.
    for (const item of items) {
      const result = (status: SubmissionResult["status"], message: string, retryable = false) =>
        results.push({ ...item, status, message, ...(retryable ? { retryable } : {}) })
      if (!item.name) { result("invalid", "Invalid subreddit name or Reddit link"); continue }
      if (known.has(item.name)) { result("existing", "Already in the database"); continue }
      try {
        if (tokenFailed) { result("failed", "Reddit verification is temporarily unavailable", true); continue }
        if (!accessToken) {
          try { accessToken = await getRedditAccessToken() } catch {
            tokenFailed = true
            result("failed", "Reddit verification is temporarily unavailable", true)
            continue
          }
        }
        const response = await fetch(`https://oauth.reddit.com/r/${item.name}/about`, {
          headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": process.env.REDDIT_USER_AGENT || "ofmreddit/1.0" },
          cache: "no-store", signal: AbortSignal.timeout(6_000),
        })
        if (response.status === 404) { result("invalid", "Subreddit not found or banned"); continue }
        if (response.status === 403) { result("failed", "Private or unavailable to the verification account", true); continue }
        if (!response.ok) {
          result("failed", "Reddit verification is temporarily unavailable; retry this name", true)
          if (response.status === 429 || response.status === 401) tokenFailed = true
          continue
        }
        const data = (await response.json())?.data
        if (!data || typeof data.over18 !== "boolean" || String(data.display_name || "").toLowerCase() !== item.name) {
          result("failed", "Reddit returned incomplete or mismatched community data", true); continue
        }
        if (!data.over18) { result("invalid", "Subreddit must be NSFW (18+)"); continue }
        const subscribers = Number.isSafeInteger(data.subscribers) && data.subscribers >= 0 ? data.subscribers : 0
        const saved = await queueSubredditSubmission(item.name, niche.value, subscribers, user.userId)
        const messages: Record<string, string> = {
          submitted: "Submitted for admin approval", pending: "Already awaiting review; your submission is recorded",
          existing: "Already approved", rejected: "Previously rejected; contact an admin for review",
          archived: "Archived community; an admin must restore it first",
        }
        result(saved, messages[saved] || "Submission recorded")
      } catch (error) {
        console.error(`Subreddit submission failed for r/${item.name}:`, error instanceof Error ? error.name : "Unknown error")
        result("failed", "Submission did not finish; retry this name", true)
      }
    }
    return NextResponse.json({ success: results.some(result => ["submitted", "pending", "existing"].includes(result.status)),
      results, duplicates, paused: tokenFailed }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Subreddit submission prerequisites failed:", error instanceof Error ? error.name : "Unknown error")
    return NextResponse.json({ error: "Submission service is temporarily unavailable. Your list is unchanged." }, { status: 503 })
  }
}
