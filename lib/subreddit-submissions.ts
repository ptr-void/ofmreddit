export const MAX_PASTED_SUBREDDITS = 100
export const SUBMISSION_BATCH_SIZE = 5
export const MAX_SUBREDDIT_INPUT_LENGTH = 16_000

export type SubmissionResult = {
  input: string
  name: string | null
  status: "submitted" | "pending" | "existing" | "rejected" | "archived" | "invalid" | "failed"
  message: string
  retryable?: boolean
}

/** Accept plain names, r/name, and Reddit links; never use pasted URLs as fetch targets. */
export function submissionName(input: string): string | null {
  let name = input.trim()
  if (/^https?:\/\//i.test(name)) {
    try {
      const url = new URL(name)
      if (!/^(?:(?:www|old|new|np|m)\.)?reddit\.com$/i.test(url.hostname)) return null
      name = /^\/r\/([a-z0-9_]+)(?:\/|$)/i.exec(url.pathname)?.[1] || ""
    } catch { return null }
  } else {
    name = name.replace(/^\/?r\//i, "").replace(/\/$/, "")
  }
  return /^[a-z0-9_]{2,21}$/i.test(name) ? name.toLowerCase() : null
}

export function parseSubredditList(value: string | string[]) {
  const text = (Array.isArray(value) ? value.join("\n") : value)
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
  const seen = new Set<string>()
  let duplicates = 0
  const items: { input: string; name: string | null }[] = []
  for (const input of text.split(/[\s,;]+/).filter(Boolean)) {
    const name = submissionName(input)
    const key = name || input.toLowerCase()
    if (seen.has(key)) { duplicates++; continue }
    seen.add(key)
    items.push({ input, name })
  }
  return { items, duplicates }
}

export function submissionFinished(result: SubmissionResult) {
  return ["submitted", "pending", "existing"].includes(result.status)
}
