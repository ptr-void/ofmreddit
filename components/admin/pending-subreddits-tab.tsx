"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Candidate = { id: number; subreddit_name: string; subscribers: number | null; niche_tags: string | null; discovery_json: string | null; requested_action: string | null }
type Availability = { subreddit_name: string; state: string; dead_checks: number; last_evidence: string | null; last_checked_at: string | null; requested_action: string | null }
function discovery(value: string | null) {
  try { return value ? JSON.parse(value) : null } catch { return null }
}
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token") || ""}` })

export function PendingSubredditsTab() {
  const [subreddits, setSubreddits] = useState<Candidate[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const fetchPending = async () => {
    try {
      const res = await fetch("/api/admin/pending", { headers: headers(), cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Review queue unavailable")
      setSubreddits(data.subreddits || [])
      setAvailability(data.availability || [])
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setLoading(false) }
  }
  useEffect(() => { fetchPending() }, [])
  const handleAction = async (action: "approve" | "reject" | "restore", item: { id?: number; subreddit_name: string }) => {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/pending", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ id: item.id, subreddit: item.subreddit_name, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Action could not be saved")
      toast({ title: "Saved", description: data.queued ? "Queued for the next maintenance run. Sheet data is verified before publishing." : "Candidate rejected." })
      await fetchPending()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally { setBusy(false) }
  }
  if (loading) return <div>Loading subreddit review...</div>
  return <div className="space-y-6 bg-card rounded-lg border border-border p-6 shadow-sm">
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-xl font-semibold">Subreddit Review</h2>
      <Button variant="outline" size="sm" onClick={fetchPending} disabled={busy}>Refresh</Button>
    </div>
    <p className="text-sm text-muted-foreground">
      Discoveries and user submissions stay here until approved. Automatic discovery looks for public communities with at least 100 members and a recent post within 30 days. Niche tags remain manually maintained.
    </p>
    {!subreddits.length ? <p className="text-sm text-muted-foreground">No pending candidates.</p> : <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Subreddit</TableHead><TableHead>Members</TableHead><TableHead>Source / Latest Post</TableHead><TableHead>Niche</TableHead><TableHead>Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>{subreddits.map(sub => {
          const found = discovery(sub.discovery_json)
          return <TableRow key={sub.id}>
            <TableCell><a className="text-blue-500" href={`https://www.reddit.com/r/${encodeURIComponent(sub.subreddit_name)}/`} target="_blank" rel="noreferrer">{sub.subreddit_name}</a></TableCell>
            <TableCell>{sub.subscribers == null ? "Unknown" : Number(sub.subscribers).toLocaleString("en-US")}</TableCell>
            <TableCell>{found ? `Discovery / ${found.latest_post_utc ? new Date(found.latest_post_utc * 1000).toLocaleDateString() : "Unknown"}` : "User submission"}</TableCell>
            <TableCell>{sub.niche_tags || "Not assigned"}</TableCell>
            <TableCell className="space-x-2 whitespace-nowrap">
              {sub.requested_action === "add" ? <span className="text-muted-foreground text-sm">Addition queued</span> : <Button size="sm" disabled={busy} onClick={() => handleAction("approve", sub)}>Approve</Button>}
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => handleAction("reject", sub)}>Reject</Button>
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
          <TableCell>{sub.state === "archived" && (sub.requested_action === "restore" ? "Restore queued" : <Button size="sm" variant="outline" disabled={busy} onClick={() => handleAction("restore", sub)}>Restore</Button>)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>}
  </div>
}
