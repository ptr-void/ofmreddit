"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from "@/components/ui/alert-dialog"
import { Loader2, Search, Activity, Clock, ShieldAlert, Star } from "lucide-react"

type CheckerResult = {
  minPostKarma: number
  minCommentKarma: number
  minTotalKarma: number
  minAccountAgeDays: number
  analyzedAccounts: number
}

export default function SubredditCheckerPage() {
  const { toast } = useToast()
  const [subreddit, setSubreddit] = useState("")
  const [postLimit, setPostLimit] = useState(50)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CheckerResult | null>(null)
  const [errorDialog, setErrorDialog] = useState<string | null>(null)
  const [usageInfo, setUsageInfo] = useState<{ usage: number; cap: number } | null>(null)
  const router = useRouter()

  const fetchUsage = async () => {
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feature: "subreddit_checker", op: "check" })
      })
      const data = await res.json()
      if (res.ok || res.status === 429) {
        if (data.cap !== undefined) {
          setUsageInfo({ usage: data.usage || 0, cap: data.cap })
        }
      }
    } catch (e) {}
  }

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) {
      router.push("/login")
    } else {
      fetchUsage()
    }
  }, [router])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!subreddit.trim()) {
      toast({ title: "Error", description: "Please enter a subreddit name", variant: "destructive" })
      return
    }

    try {
      setLoading(true)
      setResult(null)
      
      const token = localStorage.getItem("token")
      const res = await fetch("/api/subreddit-checker", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ subreddit: subreddit.trim(), limit: postLimit })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to check subreddit")
      }

      setResult(data.data)
      await fetchUsage()
      
    } catch (error: any) {
      toast({
        title: "Scan Failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-4xl min-h-[80vh] flex flex-col items-center justify-center space-y-8">
      
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Subreddit Requirements Checker</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Instantly discover the minimum karma and account age required to post in any subreddit based on recent successful posts.
        </p>
      </div>

      <Card className="w-full max-w-2xl border-primary/20 shadow-lg">
        <CardContent className="p-6">
          <form onSubmit={handleSearch} className="flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">r/</span>
                <Input
                  value={subreddit}
                  onChange={(e) => setSubreddit(e.target.value)}
                  placeholder="funny"
                  className="pl-8 text-lg h-14 bg-background"
                  disabled={loading}
                />
              </div>
              <Button type="submit" size="lg" className="h-14 px-8 text-lg" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Search className="w-5 h-5 mr-2" />}
                {loading ? "Scanning..." : "Check"}
              </Button>
            </div>
            
            <div className="flex flex-col space-y-2 mt-2">
              <label className="text-sm font-medium text-muted-foreground flex justify-between">
                <span>Posts to Analyze (Sample Size)</span>
                <span className="text-foreground font-bold">{postLimit}</span>
              </label>
              <input 
                type="range" 
                min="10" 
                max="200" 
                step="10" 
                value={postLimit} 
                onChange={(e) => setPostLimit(Number(e.target.value))}
                disabled={loading}
                className="w-full accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                Scrapes the latest {postLimit} posts. Removed posts, deleted accounts, bots, and duplicate posters are not included for more accurate results. This is why the final number of analyzed accounts is usually lower than the sample size.
              </span>
            </div>
          </form>

          {usageInfo && (
            <div className="mt-4 text-center text-sm font-medium text-muted-foreground bg-muted/50 p-2 rounded-lg">
              Daily Scrapes Used: <span className="text-foreground">{usageInfo.usage} / {usageInfo.cap}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Card>
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">Requirements for r/{subreddit.replace(/^r\//i, '')}</CardTitle>
              <CardDescription>
                Based on analysis of the {result.analyzedAccounts} most recent successful posters.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                
                <div className="flex flex-col items-center justify-between p-5 bg-muted/50 rounded-xl text-center border h-full">
                  <div className="flex flex-col items-center">
                    <div className="p-3 bg-blue-500/10 rounded-full mb-3">
                      <Activity className="w-6 h-6 text-blue-500" />
                    </div>
                    <h3 className="text-sm font-medium text-muted-foreground leading-tight">Min Post Karma</h3>
                  </div>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{result.minPostKarma}</span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-between p-5 bg-muted/50 rounded-xl text-center border h-full">
                  <div className="flex flex-col items-center">
                    <div className="p-3 bg-purple-500/10 rounded-full mb-3">
                      <ShieldAlert className="w-6 h-6 text-purple-500" />
                    </div>
                    <h3 className="text-sm font-medium text-muted-foreground leading-tight">Min Comment Karma</h3>
                  </div>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{result.minCommentKarma}</span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-between p-5 bg-muted/50 rounded-xl text-center border h-full">
                  <div className="flex flex-col items-center">
                    <div className="p-3 bg-orange-500/10 rounded-full mb-3">
                      <Star className="w-6 h-6 text-orange-500" />
                    </div>
                    <h3 className="text-sm font-medium text-muted-foreground leading-tight">Min Total Karma</h3>
                  </div>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{result.minTotalKarma}</span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-between p-5 bg-muted/50 rounded-xl text-center border h-full">
                  <div className="flex flex-col items-center">
                    <div className="p-3 bg-green-500/10 rounded-full mb-3">
                      <Clock className="w-6 h-6 text-green-500" />
                    </div>
                    <h3 className="text-sm font-medium text-muted-foreground leading-tight">Min Account Age</h3>
                  </div>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-foreground">{result.minAccountAgeDays}</span>
                    <span className="text-sm text-muted-foreground font-medium">days</span>
                  </div>
                </div>

              </div>
              <div className="mt-8 text-center text-sm text-muted-foreground bg-muted p-4 rounded-lg">
                <strong>Note:</strong> each number represents the lowest number found for that parameter so the actual minimum requirements may be lower.
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog open={!!errorDialog} onOpenChange={(open) => !open && setErrorDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scan Failed</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {errorDialog}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialog(null)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
