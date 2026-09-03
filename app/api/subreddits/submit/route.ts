import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { subreddit, tags } = await req.json()
    
    if (!subreddit) {
      return NextResponse.json({ error: "Subreddit name is required" }, { status: 400 })
    }

    const cleanSubreddit = String(subreddit).trim().replace(/^r\//i, '')
    if (!/^[a-z0-9_]{2,21}$/i.test(cleanSubreddit)) {
      return NextResponse.json({ error: "Invalid subreddit name" }, { status: 400 })
    }

    // Scrape Reddit to check if it's NSFW and exists
    const redditRes = await fetch(`https://www.reddit.com/r/${cleanSubreddit}/about.json`, {
      headers: {
        "User-Agent": "web:ofmreddit:1.0"
      }
    });

    if (!redditRes.ok) {
      return NextResponse.json({ error: "Subreddit not found or banned" }, { status: 404 })
    }

    const redditData = await redditRes.json()
    if (!redditData.data.over18) {
      return NextResponse.json({ error: "Subreddit must be NSFW (18+)" }, { status: 400 })
    }

    // Insert as pending
    await query(
      `INSERT INTO master_subreddits (subreddit_name, niche_tags, is_nsfw, status, subscribers)
       VALUES (?, ?, 1, 'pending', ?)
       ON DUPLICATE KEY UPDATE subreddit_name = subreddit_name`,
      [cleanSubreddit, tags || "", redditData.data.subscribers || 0]
    )

    return NextResponse.json({ success: true, message: "Subreddit submitted for admin approval!" })
  } catch (err) {
    console.error("Submit subreddit error:", err)
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
