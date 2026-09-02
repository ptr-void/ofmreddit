import { type NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

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
    const postsUrl = `https://oauth.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/hot?limit=${maxPosts}`
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
    let minPostKarmaUser = ""
    let minCommentKarma = Infinity
    let minCommentKarmaUser = ""
    let minTotalKarma = Infinity
    let minTotalKarmaUser = ""
    let minAgeDays = Infinity
    let minAgeDaysUser = ""
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
          
          // CRITICAL: Filter out fresh spam bots that bypassed automod but haven't been deleted yet
          // If they have less than 5 total karma and are less than 2 days old, they are an anomaly.
          if (totalKarma < 5 && ageDays < 2) {
            continue
          }

          if (postKarma < minPostKarma) {
            minPostKarma = postKarma
            minPostKarmaUser = author
          }
          if (commentKarma < minCommentKarma) {
            minCommentKarma = commentKarma
            minCommentKarmaUser = author
          }
          if (totalKarma < minTotalKarma) {
            minTotalKarma = totalKarma
            minTotalKarmaUser = author
          }
          if (ageDays < minAgeDays) {
            minAgeDays = ageDays
            minAgeDaysUser = author
          }
          
          analyzedCount++
        }
      }
    }

    if (analyzedCount === 0) {
      return NextResponse.json({ error: "Could not fetch user profiles due to rate limits or suspended accounts" }, { status: 500 })
    }

    // New: Fetch Top 10 Posts of the Week (7-day rolling average equivalent) and check Moderators for Bot Bouncer
    let hot1Weekly = 0;
    let hot2to5WeeklyAvg = 0;
    let hot6to10WeeklyAvg = 0;
    let hasBotBouncer = false;
    let requiresVerification = false;
    let allowsCtaCaptions: boolean | null = null;
    
    try {
      // Check Subreddit About for Restricted (Verification)
      const aboutUrl = `https://oauth.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/about`
      const aboutRes = await fetch(aboutUrl, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" }
      })
      if (aboutRes.ok) {
        const aboutData = await aboutRes.json()
        if (aboutData.data?.subreddit_type === "restricted") {
          requiresVerification = true;
        }
      }

      // Check Moderators for Bot Bouncer
      const modsUrl = `https://oauth.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/about/moderators`
      const modsRes = await fetch(modsUrl, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" }
      })
      if (modsRes.ok) {
        const modsData = await modsRes.json()
        const mods = modsData.data?.children || []
        hasBotBouncer = mods.some((m: any) => {
          const normalized = String(m.name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
          return normalized.includes("botbouncer")
        });
      }

      const topUrl = `https://oauth.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/top?limit=10&t=week`
      const topRes = await fetch(topUrl, {
        headers: { 
          Authorization: `Bearer ${token}`, 
          "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" 
        }
      })
      if (topRes.ok) {
        const topData = await topRes.json()
        const topPosts = topData?.data?.children || []
        
        if (topPosts.length > 0) {
          hot1Weekly = topPosts[0].data?.ups || 0;
          
          let sum2to5 = 0;
          let count2to5 = 0;
          for(let i = 1; i < 5 && i < topPosts.length; i++) {
             sum2to5 += topPosts[i].data?.ups || 0;
             count2to5++;
          }
          if (count2to5 > 0) hot2to5WeeklyAvg = Math.floor(sum2to5 / count2to5);
          
          let sum6to10 = 0;
          let count6to10 = 0;
          for(let i = 5; i < 10 && i < topPosts.length; i++) {
             sum6to10 += topPosts[i].data?.ups || 0;
             count6to10++;
          }
          if (count6to10 > 0) hot6to10WeeklyAvg = Math.floor(sum6to10 / count6to10);
        }
      }

      // Check for CTA Captions (question marks '?', and keywords 'would', 'how', 'what', 'do', 'or', 'who', 'should', 'rate')
      // Only check live surviving posts older than 1 hour (3600s)
      const newUrl = `https://oauth.reddit.com/r/${encodeURIComponent(cleanSubreddit)}/new?limit=50`
      const newRes = await fetch(newUrl, {
        headers: { 
          Authorization: `Bearer ${token}`, 
          "User-Agent": process.env.REDDIT_USER_AGENT || "SubredditRequirementsChecker/1.0" 
        }
      })
      if (newRes.ok) {
        const newData = await newRes.json()
        const posts = newData?.data?.children || []
        const nowSecs = Math.floor(Date.now() / 1000)
        
        const maturedPosts = posts.filter((p: any) => {
          const created = p.data?.created_utc || 0
          return (nowSecs - created) >= 3600
        })

        const ctaPattern = /\?|\b(would|how|what|do|or|who|should|rate)\b/i
        let ctaCount = 0
        maturedPosts.forEach((p: any) => {
          const title = p.data?.title || ""
          if (ctaPattern.test(title)) {
            ctaCount++
          }
        })

        if (maturedPosts.length >= 5) {
          allowsCtaCaptions = ctaCount >= 2
        } else if (maturedPosts.length > 0) {
          allowsCtaCaptions = ctaCount >= 1
        }
      }
    } catch (e) {
      console.error("Failed to fetch subreddit metadata", e)
    }

      const currentData = {
        minPostKarma: minPostKarma === Infinity ? 0 : minPostKarma,
        minPostKarmaUser,
        minCommentKarma: minCommentKarma === Infinity ? 0 : minCommentKarma,
        minCommentKarmaUser,
        minTotalKarma: minTotalKarma === Infinity ? 0 : minTotalKarma,
        minTotalKarmaUser,
        minAccountAgeDays: minAgeDays === Infinity ? 0 : minAgeDays,
        minAccountAgeUser: minAgeDaysUser,
        analyzedAccounts: analyzedCount,
        hot1Weekly,
        hot2to5WeeklyAvg,
        hot6to10WeeklyAvg,
        hasBotBouncer,
        requiresVerification,
        allowsCtaCaptions
      }

      let previousData = null
      try {
        const prevRows = await query<any>("SELECT * FROM subreddit_metrics_cache WHERE subreddit = ? LIMIT 1", [cleanSubreddit.toLowerCase()])
        if (prevRows && prevRows.length > 0) {
          const row = prevRows[0]
          previousData = {
            minPostKarma: row.min_post_karma,
            minPostKarmaUser: row.min_post_karma_user,
            minCommentKarma: row.min_comment_karma,
            minCommentKarmaUser: row.min_comment_karma_user,
            minTotalKarma: row.min_total_karma,
            minTotalKarmaUser: row.min_total_karma_user,
            minAccountAgeDays: row.min_account_age_days,
            minAccountAgeUser: row.min_account_age_user,
            analyzedAccounts: row.analyzed_accounts,
            updatedAt: row.updated_at
          }
        }

        await query(
          `INSERT INTO subreddit_metrics_cache (
            subreddit, min_post_karma, min_post_karma_user, min_comment_karma, min_comment_karma_user, min_total_karma, min_total_karma_user, min_account_age_days, min_account_age_user, analyzed_accounts, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            min_post_karma_user = IF(VALUES(min_post_karma) < min_post_karma, VALUES(min_post_karma_user), min_post_karma_user),
            min_post_karma = LEAST(min_post_karma, VALUES(min_post_karma)),
            min_comment_karma_user = IF(VALUES(min_comment_karma) < min_comment_karma, VALUES(min_comment_karma_user), min_comment_karma_user),
            min_comment_karma = LEAST(min_comment_karma, VALUES(min_comment_karma)),
            min_total_karma_user = IF(VALUES(min_total_karma) < min_total_karma, VALUES(min_total_karma_user), min_total_karma_user),
            min_total_karma = LEAST(min_total_karma, VALUES(min_total_karma)),
            min_account_age_user = IF(VALUES(min_account_age_days) < min_account_age_days, VALUES(min_account_age_user), min_account_age_user),
            min_account_age_days = LEAST(min_account_age_days, VALUES(min_account_age_days)),
            analyzed_accounts = VALUES(analyzed_accounts),
            updated_at = NOW()`,
          [
            cleanSubreddit.toLowerCase(),
            currentData.minPostKarma, currentData.minPostKarmaUser,
            currentData.minCommentKarma, currentData.minCommentKarmaUser,
            currentData.minTotalKarma, currentData.minTotalKarmaUser,
            currentData.minAccountAgeDays, currentData.minAccountAgeUser,
            currentData.analyzedAccounts
          ]
        )
        
        // Upsert into master_subreddits too
        await query(
          `INSERT INTO master_subreddits (
            subreddit_name, hot_1_weekly, hot_2_5_weekly_avg, hot_6_10_weekly_avg,
            min_post_karma, min_comment_karma, min_combined_karma, min_account_age_days, status,
            has_bot_bouncer, requires_verification, allows_cta_captions
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            hot_1_weekly = VALUES(hot_1_weekly),
            hot_2_5_weekly_avg = VALUES(hot_2_5_weekly_avg),
            hot_6_10_weekly_avg = VALUES(hot_6_10_weekly_avg),
            min_post_karma = VALUES(min_post_karma),
            min_comment_karma = VALUES(min_comment_karma),
            min_combined_karma = VALUES(min_combined_karma),
            min_account_age_days = VALUES(min_account_age_days),
            has_bot_bouncer = VALUES(has_bot_bouncer),
            requires_verification = VALUES(requires_verification),
            allows_cta_captions = IF(VALUES(allows_cta_captions) IS NOT NULL, VALUES(allows_cta_captions), allows_cta_captions)`,
          [
            cleanSubreddit.toLowerCase(),
            hot1Weekly, hot2to5WeeklyAvg, hot6to10WeeklyAvg,
            currentData.minPostKarma, currentData.minCommentKarma, currentData.minTotalKarma, currentData.minAccountAgeDays,
            hasBotBouncer, requiresVerification,
            allowsCtaCaptions === null ? null : (allowsCtaCaptions ? 1 : 0)
          ]
        )
      } catch (dbErr) {
        console.error("Database cache error:", dbErr)
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
      data: currentData,
      previous: previousData
    })

  } catch (error: any) {
    console.error("Subreddit checker error:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
