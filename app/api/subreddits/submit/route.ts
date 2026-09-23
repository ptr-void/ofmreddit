import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { query } from "@/lib/db"
import { validateNicheTags } from "@/lib/niche-presets"
import { getRedditAccessToken } from "@/lib/reddit-oauth"

function userFromRequest(req: Request) {
  const header = req.headers.get("authorization") || ""
  const token = header.replace(/^Bearer\s+/i, "")
  return token ? verifyToken(token) : null
}

export async function POST(req: Request) {
  try {
    const user = userFromRequest(req)
    if (!user?.userId) {
      return NextResponse.json({ error: "Sign in before submitting a subreddit" }, { status: 401 })
    }

    const { subreddit, tags } = await req.json()
    
    if (!subreddit) {
      return NextResponse.json({ error: "Subreddit name is required" }, { status: 400 })
    }

    const cleanSubreddit = String(subreddit).trim().replace(/^r\//i, '').toLowerCase()
    if (!/^[a-z0-9_]{2,21}$/i.test(cleanSubreddit)) {
      return NextResponse.json({ error: "Invalid subreddit name" }, { status: 400 })
    }

    const niche = await validateNicheTags(tags)
    if (!niche.ok) return NextResponse.json({ error: niche.error }, { status: 400 })
    const nicheTags = niche.value

    // The unauthenticated www.reddit.com endpoint can return 403/429 for an
    // existing community, so validate with the same OAuth API used by SPA.
    const accessToken = await getRedditAccessToken()
    const redditRes = await fetch(`https://oauth.reddit.com/r/${cleanSubreddit}/about`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": process.env.REDDIT_USER_AGENT || "ofmreddit/1.0",
      },
      cache: "no-store",
    })
    if (redditRes.status === 404) {
      return NextResponse.json({ error: "Subreddit not found" }, { status: 404 })
    }
    if (redditRes.status === 403) {
      return NextResponse.json({ error: "Subreddit is private or unavailable to the Reddit account used for verification" }, { status: 403 })
    }
    if (!redditRes.ok) {
      return NextResponse.json({ error: "Reddit verification is temporarily unavailable. Please try again later." }, { status: 503 })
    }
    const redditData = await redditRes.json()
    if (!redditData?.data || typeof redditData.data.over18 !== "boolean") {
      return NextResponse.json({ error: "Reddit verification returned incomplete data. Please try again later." }, { status: 503 })
    }
    if (!redditData.data.over18) {
      return NextResponse.json({ error: "Subreddit must be NSFW (18+)" }, { status: 400 })
    }

    // Insert as pending
    await query(
      `INSERT INTO master_subreddits (subreddit_name, niche_tags, is_nsfw, status, subscribers)
       VALUES (?, ?, 1, 'pending', ?)
       ON DUPLICATE KEY UPDATE
         niche_tags = IF(status = 'pending' AND TRIM(COALESCE(niche_tags, '')) = '', VALUES(niche_tags), niche_tags)`,
      [cleanSubreddit, nicheTags, redditData.data.subscribers || 0]
    )

    await query(
      `INSERT INTO subreddit_submission_attempts (subreddit_name, user_id, source, niche_tags)
       SELECT ?, ?, 'database', ?
       FROM master_subreddits
       WHERE LOWER(subreddit_name) = ? AND status = 'pending'
       ON DUPLICATE KEY UPDATE
         source = VALUES(source), niche_tags = VALUES(niche_tags), updated_at = CURRENT_TIMESTAMP`,
      [cleanSubreddit, user.userId, nicheTags, cleanSubreddit]
    )

    return NextResponse.json({ success: true, message: "Subreddit submitted for admin approval!" })
  } catch (err) {
    console.error("Submit subreddit error:", err)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
