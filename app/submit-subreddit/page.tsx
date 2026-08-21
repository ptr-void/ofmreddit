"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, CheckCircle2 } from "lucide-react"
import s from "@/styles/scraper.module.css"

export default function SubmitSubredditPage() {
  const [subreddit, setSubreddit] = useState("")
  const [tags, setTags] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/subreddits/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subreddit, tags }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Failed to submit subreddit")
        return
      }

      setSuccess(true)
      setSubreddit("")
      setTags("")
    } catch (err) {
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`min-h-screen flex items-center justify-center ${s.bgPattern} p-4`}>
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground">Submit Subreddit</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Help grow the database! Submit an NSFW subreddit for admin approval.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-md flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <p className="text-sm text-green-600 font-medium">Subreddit submitted successfully! Pending admin approval.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subreddit">Subreddit Name</Label>
            <Input
              id="subreddit"
              placeholder="e.g. OnlyFansPromotions"
              value={subreddit}
              onChange={(e) => setSubreddit(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Niche / Tags (comma separated)</Label>
            <Input
              id="tags"
              placeholder="e.g. blondes, verification, big boobs"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full mt-2" disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning...</> : "Submit for Review"}
          </Button>
          
          <div className="text-center mt-4">
             <Button variant="ghost" type="button" onClick={() => setSuccess(false)} className="text-xs">
                Submit Another
             </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
