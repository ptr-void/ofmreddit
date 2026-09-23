export async function getRedditAccessToken(): Promise<string> {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN
  const userAgent = process.env.REDDIT_USER_AGENT
  if (!clientId || !clientSecret || !refreshToken || !userAgent) {
    throw new Error("Reddit API credentials are not configured")
  }
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  })
  if (!response.ok) throw new Error(`Reddit authentication failed (${response.status})`)
  const data = await response.json()
  if (!data?.access_token) throw new Error("Reddit authentication returned no access token")
  return data.access_token as string
}
