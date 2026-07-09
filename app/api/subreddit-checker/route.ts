import { type NextRequest, NextResponse } from "next/server"

interface RedditTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN
  const userAgent = process.env.REDDIT_USER_AGENT
  if (!clientId || !clientSecret || !refreshToken || !userAgent) {
    throw new Error("Missing Reddit API credentials in .env file")
  }
  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { 
      Authorization: `Basic ${authString}`, 
      "Content-Type": "application/x-www-form-urlencoded", 
      "User-Agent": userAgent 
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString()
  })
  if (!response.ok) throw new Error(`Failed to obtain access token: ${response.status}`)
  const data = (await response.json()) as RedditTokenResponse
  if (!data.access_token) throw new Error("No access token received from Reddit API")
  return data.access_token
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(request: NextRequest) {
  try {
    const { subreddit, limit = 100 } = await request.json()
    
    if (!subreddit) {
      return NextResponse.json({ error: "Subreddit name is required" }, { status: 400 })
    }

    const usageUrl = new URL("/api/usage", request.url).toString()
    const pre = await fetch(usageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
        authorization: request.headers.get("authorization") || ""
      },
      body: JSON.stringify({ feature: "subreddit_checker", op: "check" })
    })
    
    if (!pre.ok) {
      const j = await pre.json().catch(() => ({}))
      return NextResponse.json({ error: j?.error || "Usage limit reached or not allowed" }, { status: pre.status })
    }

    const maxPosts = Math.min(Math.max(10, Number(limit) || 100), 200) // cap between 10 and 200
    const cleanSubreddit = subreddit.replace(/^r\//i, '').trim()
    let token = await getAccessToken()

    // 1. Fetch recent posts from the subreddit
    const postsUrl = `https://oauth.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/new?limit=${maxPosts}`
    const postsRes = await fetch(postsUrl, {
      headers: { 
        Authorization: `Bearer ${token}`, 
        "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" 
      }
    })

    if (!postsRes.ok) {
      if (postsRes.status === 404) {
        return NextResponse.json({ error: "Subreddit not found" }, { status: 404 })
      }
      return NextResponse.json({ error: "Failed to fetch subreddit posts" }, { status: 500 })
    }

    const postsData = await postsRes.json()
    const posts = postsData?.data?.children || []

    if (posts.length === 0) {
      return NextResponse.json({ error: "No posts found in this subreddit" }, { status: 404 })
    }

    // 2. Extract unique authors (ignore deleted and automod)
    const uniqueAuthors = new Set<string>()
    for (const p of posts) {
      if (p.data?.removed_by_category || p.data?.banned_by) continue;
      
      const author = p.data?.author
      if (author && author !== "[deleted]" && author.toLowerCase() !== "automoderator") {
        uniqueAuthors.add(author)
      }
    }

    // No hardcoded slice limit, we will process all unique authors found in the requested posts
    const authorsList = Array.from(uniqueAuthors)

    if (authorsList.length === 0) {
      return NextResponse.json({ error: "No valid authors found to analyze" }, { status: 404 })
    }

    // 3. Fetch user profiles to find minimums
    let minPostKarma = Infinity
    let minCommentKarma = Infinity
    let minTotalKarma = Infinity
    let minAgeDays = Infinity
    let analyzedCount = 0
    const nowSecs = Math.floor(Date.now() / 1000)

    for (const author of authorsList) {
      await sleep(150) // Rate limit protection
      
      const userUrl = `https://oauth.reddit.com/user/${encodeURIComponent(author)}/about`
      let userRes = await fetch(userUrl, {
        headers: { 
          Authorization: `Bearer ${token}`, 
          "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" 
        }
      })

      // Handle token expiration mid-loop
      if (userRes.status === 401) {
        token = await getAccessToken()
        userRes = await fetch(userUrl, {
          headers: { 
            Authorization: `Bearer ${token}`, 
            "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" 
          }
        })
      }

      if (userRes.ok) {
        const userData = await userRes.json()
        const profile = userData?.data

        if (profile) {
          const postKarma = profile.link_karma || 0
          const commentKarma = profile.comment_karma || 0
          const totalKarma = profile.total_karma || (postKarma + commentKarma)
          const createdUtc = profile.created_utc || nowSecs
          
          const ageDays = Math.max(0, Math.floor((nowSecs - createdUtc) / 86400))

          if (postKarma < minPostKarma) minPostKarma = postKarma
          if (commentKarma < minCommentKarma) minCommentKarma = commentKarma
          if (totalKarma < minTotalKarma) minTotalKarma = totalKarma
          if (ageDays < minAgeDays) minAgeDays = ageDays
          
          analyzedCount++
        }
      }
    }

    if (analyzedCount === 0) {
      return NextResponse.json({ error: "Could not fetch user profiles due to rate limits or suspended accounts" }, { status: 500 })
    }

    // Record successful usage
    await fetch(usageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
        authorization: request.headers.get("authorization") || ""
      },
      body: JSON.stringify({ feature: "subreddit_checker", op: "record", meta: { subreddit: cleanSubreddit } })
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      data: {
        minPostKarma: minPostKarma === Infinity ? 0 : minPostKarma,
        minCommentKarma: minCommentKarma === Infinity ? 0 : minCommentKarma,
        minTotalKarma: minTotalKarma === Infinity ? 0 : minTotalKarma,
        minAccountAgeDays: minAgeDays === Infinity ? 0 : minAgeDays,
        analyzedAccounts: analyzedCount
      }
    })

  } catch (error: any) {
    console.error("Subreddit checker error:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
