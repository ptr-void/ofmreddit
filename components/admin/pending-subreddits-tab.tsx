"use client"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NicheTagSelect } from "@/components/niche-tag-select"

type Candidate = { id: number; subreddit_name: string; subscribers: number | null; niche_tags: string | null; discovery_json: string | null; requested_action: string | null; submitted_by: string | null }
type Availability = { subreddit_name: string; state: string; dead_checks: number; last_evidence: string | null; last_checked_at: string | null; requested_action: string | null }
function discovery(value: string | null) {
  try { return value ? JSON.parse(value) : null } catch { return null }
}
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` })

export function PendingSubredditsTab() {
  const [subreddits, setSubreddits] = useState<Candidate[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingActions, setPendingActions] = useState<Record<string, "approve" | "reject" | "restore">>({})
  const [nicheDrafts, setNicheDrafts] = useState<Record<number, string>>({})
  const actionQueue = useRef<Promise<void>>(Promise.resolve())
  const { toast } = useToast()
  const fetchPending = async () => {
    try {
      const res = await fetch("/api/admin/pending", { headers: headers(), cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Review queue unavailable")
      setSubreddits(data.subreddits || [])
      setNicheDrafts(Object.fromEntries((data.subreddits || []).map((sub: Candidate) => [sub.id, sub.niche_tags || ""])))
      setAvailability(data.availability || [])
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setLoading(false) }
  }
  useEffect(() => { fetchPending() }, [])
  const handleAction = (action: "approve" | "reject" | "restore", item: { id?: number; subreddit_name: string }) => {
    const key = String(item.id ?? item.subreddit_name)
    if (pendingActions[key]) return

    // Update the row immediately. Requests are serialized in the background so
    // rapid clicks never contend for the maintenance lock or block the table.
    setPendingActions((current) => ({ ...current, [key]: action }))
    actionQueue.current = actionQueue.current.then(async () => {
      try {
        const res = await fetch("/api/admin/pending", {
          method: "POST", headers: headers(),
          body: JSON.stringify({
            id: item.id,
            subreddit: item.subreddit_name,
            action,
            niche_tags: action === "approve" && item.id ? nicheDrafts[item.id] || "" : undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Action could not be saved")
        setSubreddits((current) => action === "reject"
          ? current.filter((sub) => sub.id !== item.id)
          : current.map((sub) => sub.id === item.id ? { ...sub, requested_action: "add" } : sub))
        setAvailability((current) => action === "restore"
          ? current.map((sub) => sub.subreddit_name === item.subreddit_name ? { ...sub, requested_action: "restore" } : sub)
          : current)
      } catch (e: any) {
        toast({ title: "Error", description: `${item.subreddit_name}: ${e.message}`, variant: "destructive" })
      } finally {
        setPendingActions((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    })
  }
  if (loading) return <div>Loading subreddit review...</div>
  return <div className="space-y-6 bg-card rounded-lg border border-border p-6 shadow-sm">
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-xl font-semibold">Subreddit Review</h2>
      <Button variant="outline" size="sm" onClick={fetchPending}>Refresh</Button>
    </div>
    <p className="text-sm text-muted-foreground">
      Discoveries and user submissions stay here until approved. Automatic discovery requires at least 100,000 members, a post within 30 days, and a weekly top post with at least 100 upvotes. The niche is suggested from the discovery query.
    </p>
    {!subreddits.length ? <p className="text-sm text-muted-foreground">No pending candidates.</p> : <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Subreddit</TableHead><TableHead>Members</TableHead><TableHead>Weekly Top 1</TableHead><TableHead>Source / Latest Post</TableHead><TableHead>Submitted By</TableHead><TableHead>Niche</TableHead><TableHead>Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>{subreddits.map(sub => {
          const found = discovery(sub.discovery_json)
          return <TableRow key={sub.id}>
            <TableCell><a className="text-blue-500" href={`https://www.reddit.com/r/${encodeURIComponent(sub.subreddit_name)}/`} target="_blank" rel="noreferrer">{sub.subreddit_name}</a></TableCell>
            <TableCell>{sub.subscribers == null ? "Unknown" : Number(sub.subscribers).toLocaleString("en-US")}</TableCell>
            <TableCell>{found?.top1_weekly == null ? "—" : Number(found.top1_weekly).toLocaleString("en-US")}</TableCell>
            <TableCell>{found ? `Discovery / ${found.latest_post_utc ? new Date(found.latest_post_utc * 1000).toLocaleDateString() : "Unknown"}` : "User submission"}</TableCell>
            <TableCell className="max-w-xs text-sm">{sub.submitted_by || (found ? "Automatic discovery" : "Unknown user")}</TableCell>
            <TableCell className="min-w-56">
              <NicheTagSelect
                value={nicheDrafts[sub.id] ?? sub.niche_tags ?? ""}
                onChange={(value) => setNicheDrafts((current) => ({ ...current, [sub.id]: value }))}
                disabled={sub.requested_action === "add" || !!pendingActions[String(sub.id)]}
                id={`review-niche-${sub.id}`}
              />
            </TableCell>
            <TableCell className="space-x-2 whitespace-nowrap">
              {sub.requested_action === "add" || pendingActions[String(sub.id)] === "approve"
                ? <span className="text-muted-foreground text-sm">Addition queued</span>
                : <Button size="sm" onClick={() => handleAction("approve", sub)}>Approve</Button>}
              <Button variant="destructive" size="sm" disabled={!!pendingActions[String(sub.id)]} onClick={() => handleAction("reject", sub)}>Reject</Button>
            </TableCell>
          </TableRow>
        })}</TableBody>
      </Table>
    </div>}
    <h3 className="text-lg font-semibold">Availability Checks &amp; Archived Rows</h3>
    <p className="text-sm text-muted-foreground">Archival requires three separate checks at least 24 hours apart, spanning at least 48 hours. Private communities, temporary errors and low member counts are not removal evidence. Archived rows are retained for restoration.</p>
    {!availability.length ? <p className="text-sm text-muted-foreground">No communities under review or archived.</p> : <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader><TableRow><TableHead>Subreddit</TableHead><TableHead>Status</TableHead><TableHead>Checks</TableHead><TableHead>Evidence</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
        <TableBody>{availability.map(sub => <TableRow key={sub.subreddit_name}>
          <TableCell>{sub.subreddit_name}</TableCell>
          <TableCell>{sub.state === "archived" ? "Archived" : "Under review"}</TableCell>
          <TableCell>{sub.dead_checks} / 3</TableCell>
          <TableCell className="max-w-md text-sm">{sub.last_evidence}<div className="text-muted-foreground">{sub.last_checked_at ? new Date(sub.last_checked_at).toLocaleString() : ""}</div></TableCell>
          <TableCell>{sub.state === "archived" && (sub.requested_action === "restore" || pendingActions[sub.subreddit_name] === "restore" ? "Restore queued" : <Button size="sm" variant="outline" onClick={() => handleAction("restore", sub)}>Restore</Button>)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>}
  </div>
}
