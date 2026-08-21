"use client"

import { useState, useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Activity, Globe, Monitor, MousePointerClick } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

type Visit = {
  id: number
  page_path: string
  ip_address: string
  user_agent: string
  visited_at: string
}

type TopPage = {
  page_path: string
  visit_count: number
}

type VisitDay = {
  date: string
  count: number
}

type AnalyticsData = {
  totalVisits: number
  visitsToday: number
  recentVisits: Visit[]
  topPages: TopPage[]
  visitsByDay: VisitDay[]
}

export function VisitsTab() {
  const { toast } = useToast()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const fetchAnalytics = async () => {
    const token = localStorage.getItem("token")
    if (!token) return

    try {
      setIsLoading(true)
      const res = await fetch("/api/admin/visits", {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) {
        throw new Error("Failed to fetch analytics")
      }

      const analyticsData = await res.json()
      
      // Format dates and ensure count is a number for the chart
      if (analyticsData.visitsByDay) {
        analyticsData.visitsByDay = analyticsData.visitsByDay.map((v: any) => ({
          ...v,
          date: new Date(v.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          count: Number(v.count)
        }))
      }
      
      setData(analyticsData)
    } catch (error: any) {
      console.error("Error fetching analytics:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to load visit data",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const formatUserAgent = (ua: string) => {
    if (!ua || ua === "unknown") return "Unknown Device"
    if (ua.includes("Mobile")) return "Mobile"
    if (ua.includes("Windows")) return "Windows"
    if (ua.includes("Mac OS")) return "Mac"
    if (ua.includes("Linux")) return "Linux"
    return "Desktop"
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return <div className="p-6 text-center text-muted-foreground">No data available. Ensure the website_visits table is created.</div>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Page Views</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalVisits.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Lifetime visits recorded</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Visits Today</CardTitle>
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.visitsToday.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Unique views today</p>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-full">
        <CardHeader>
          <CardTitle>Visits Over Time (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.visitsByDay || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#1e293b", borderRadius: "8px", color: "#f8fafc" }}
                  itemStyle={{ color: "#3b82f6" }}
                />
                <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: "#3b82f6" }} activeDot={{ r: 6 }} name="Visits" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-medium">Recent Activity</h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page Path</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentVisits.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                         No recent visits
                       </TableCell>
                     </TableRow>
                  ) : (
                    data.recentVisits.map((visit) => (
                      <TableRow key={visit.id}>
                        <TableCell className="font-mono text-xs">{visit.page_path}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{visit.ip_address}</TableCell>
                        <TableCell className="text-xs">{formatUserAgent(visit.user_agent)}</TableCell>
                        <TableCell className="text-right text-xs">
                          {new Date(visit.visited_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Top Pages</h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topPages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center py-4 text-muted-foreground">
                        No pages visited yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.topPages.map((page, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-xs">{page.page_path}</TableCell>
                        <TableCell className="text-right font-bold">{page.visit_count}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
