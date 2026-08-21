"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function PendingSubredditsTab() {
  const [subreddits, setSubreddits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const fetchPending = async () => {
    try {
      const res = await fetch("/api/admin/pending")
      if (!res.ok) throw new Error("Failed to fetch pending subreddits")
      const data = await res.json()
      setSubreddits(data.subreddits || [])
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPending()
  }, [])

  const handleAction = async (id: number, action: "approve" | "reject") => {
    try {
      const res = await fetch("/api/admin/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      })
      if (!res.ok) throw new Error(`Failed to ${action}`)
      
      toast({ title: "Success", description: `Subreddit ${action}d successfully.` })
      fetchPending()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    }
  }

  if (loading) return <div>Loading pending subreddits...</div>

  return (
    <div className="space-y-4 bg-card rounded-lg border border-border p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Pending Approval Queue</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Review user-submitted subreddits before they appear on the main database page.
      </p>

      {subreddits.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg">
          No pending subreddits right now.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subreddit</TableHead>
                <TableHead>Hot 1 (Weekly)</TableHead>
                <TableHead>Account Age Req</TableHead>
                <TableHead>Verification Req</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subreddits.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium">r/{sub.subreddit_name}</TableCell>
                  <TableCell>{sub.hot_1_weekly || 0}</TableCell>
                  <TableCell>{sub.min_account_age_days}d</TableCell>
                  <TableCell>{sub.requires_verification ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="default" size="sm" onClick={() => handleAction(sub.id, "approve")}>
                      Approve
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleAction(sub.id, "reject")}>
                      Reject
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
