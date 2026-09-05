"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export default function SubmitSubredditModal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
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
      const token = localStorage.getItem("token")
      const res = await fetch("/api/subreddits/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token || ""}`,
        },
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
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val)
      if (!val) {
        // Reset when closed
        setTimeout(() => {
          setSuccess(false)
          setError("")
          setSubreddit("")
          setTags("")
        }, 200)
      }
    }}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit Subreddit</DialogTitle>
          <DialogDescription>
            Help grow the database! Submit an NSFW subreddit for admin approval.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
            {error}
          </div>
        )}

        {success ? (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-md flex flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <p className="text-sm text-green-600 font-medium">Subreddit submitted successfully! Pending admin approval.</p>
            <Button variant="ghost" type="button" onClick={() => setSuccess(false)} className="text-xs mt-2">
              Submit Another
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subreddit">Subreddit Name</Label>
              <Input
                id="subreddit"
                placeholder="e.g. ForeverTeens"
                value={subreddit}
                onChange={(e) => setSubreddit(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Niche / Tags (comma separated) *</Label>
              <Input
                id="tags"
                placeholder="e.g. teen, under 25, petit"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                required
                maxLength={500}
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full mt-2" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning...</> : "Submit for Review"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
