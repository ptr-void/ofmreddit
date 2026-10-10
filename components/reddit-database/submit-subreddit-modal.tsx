"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { NicheTagSelect } from "@/components/niche-tag-select"
import { Loader2 } from "lucide-react"
import { MAX_PASTED_SUBREDDITS, MAX_SUBREDDIT_INPUT_LENGTH, SUBMISSION_BATCH_SIZE, parseSubredditList, submissionFinished, type SubmissionResult } from "@/lib/subreddit-submissions"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

export default function SubmitSubredditModal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [subreddit, setSubreddit] = useState("")
  const [tags, setTags] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<SubmissionResult[]>([])
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const parsed = parseSubredditList(subreddit)

  const reset = () => { setResults([]); setError(""); setSubreddit(""); setTags("") }
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    if (!tags) { setError("Select niche tags to apply to this list"); return }
    if (parsed.items.length > MAX_PASTED_SUBREDDITS) {
      setError(`Paste up to ${MAX_PASTED_SUBREDDITS} unique subreddits at a time. Split larger lists into separate submissions.`)
      return
    }
    const token = localStorage.getItem("token")
    if (!token) { setError("Sign in before submitting subreddits"); return }
    const valid = parsed.items.filter(item => item.name)
    const collected: SubmissionResult[] = parsed.items.filter(item => !item.name)
      .map(item => ({ ...item, status: "invalid", message: "Invalid subreddit name or Reddit link" }))
    setResults(collected)
    setLoading(true)
    setProgress({ completed: collected.length, total: parsed.items.length })
    try {
      for (let offset = 0; offset < valid.length; offset += SUBMISSION_BATCH_SIZE) {
        const batch = valid.slice(offset, offset + SUBMISSION_BATCH_SIZE)
        const response = await fetch("/api/subreddits/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ subreddits: batch.map(item => item.name), tags }),
          signal: AbortSignal.timeout(65_000),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Submission service is temporarily unavailable")
        if (!Array.isArray(data.results) || data.results.length !== batch.length ||
          !batch.every((item, index) => data.results[index]?.name === item.name)) {
          throw new Error("Submission returned incomplete results. Retry the remaining names.")
        }
        collected.push(...data.results)
        setResults([...collected])
        setProgress({ completed: collected.length, total: parsed.items.length })
        // Keep successes out of subsequent retries, even if a later batch fails.
        const done = new Set(collected.filter(submissionFinished).map(item => item.name))
        setSubreddit(parsed.items.filter(item => !done.has(item.name)).map(item => item.input).join("\n"))
        if (data.paused) throw new Error("Reddit verification paused. Completed names are recorded; retry the remaining list later.")
      }
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message
        : "Submission timed out. Completed names are recorded; retry the remaining list.")
    } finally { setLoading(false) }
  }

  const queued = results.filter(item => item.status === "submitted" || item.status === "pending").length
  const existing = results.filter(item => item.status === "existing").length
  const unresolved = results.filter(item => !submissionFinished(item)).length
  return (
    <Dialog open={open} onOpenChange={next => {
      if (loading) return
      setOpen(next)
      if (!next) reset()
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Submit Subreddits</DialogTitle>
          <DialogDescription>Paste one or many NSFW subreddits for admin approval. They are added to the database only after approval.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(90vh-8rem)] space-y-4 overflow-y-auto pr-1">
        {error && <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {results.length > 0 && <section aria-label="Submission results" className="space-y-2 rounded-md border border-border p-3">
          <p role="status" className="text-sm font-medium">{queued} awaiting admin approval · {existing} already in the database · {unresolved} need attention</p>
          <ul className="max-h-44 space-y-2 overflow-y-auto text-sm">
            {results.map(item => <li key={item.name || item.input} data-submission-status={item.status}>
              <span className="font-medium break-all">{item.name ? `r/${item.name}` : item.input}</span>
              <span className={submissionFinished(item) ? "block text-muted-foreground" : "block text-destructive"}>{item.message}</span>
            </li>)}
          </ul>
          {!loading && !subreddit && <Button type="button" variant="ghost" onClick={reset}>Submit More</Button>}
        </section>}
        {(subreddit || !results.length) && <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subreddit">Subreddit names or links</Label>
            <Textarea id="subreddit" rows={5} maxLength={MAX_SUBREDDIT_INPUT_LENGTH}
              placeholder={"r/example_one\nexample_two\nhttps://www.reddit.com/r/example_three/"}
              value={subreddit} onChange={event => setSubreddit(event.target.value)} required disabled={loading}
              aria-describedby="subreddit-list-help" />
            <p id="subreddit-list-help" className="text-xs text-muted-foreground">Separate with new lines, commas, spaces or semicolons. Up to {MAX_PASTED_SUBREDDITS} names; duplicates are ignored.</p>
            <p className="text-xs text-muted-foreground" data-testid="subreddit-paste-count">{parsed.items.filter(item => item.name).length} unique names · {parsed.duplicates} duplicates ignored · {parsed.items.filter(item => !item.name).length} invalid entries</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Niche / Tags *</Label>
            <NicheTagSelect id="tags" value={tags} onChange={setTags} disabled={loading} />
            <p className="text-xs text-muted-foreground">These tags apply to every new name in this submission.</p>
          </div>
          <Button type="submit" className="w-full" disabled={loading || !parsed.items.length}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking {progress.completed}/{progress.total}...</> : "Submit for Review"}
          </Button>
        </form>}
        {loading && <p role="status" className="text-xs text-muted-foreground">Checking {progress.completed}/{progress.total}. Keep this page open until all names finish.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
