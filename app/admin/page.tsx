"use client"
import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Users } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { PromptsTab } from "@/components/admin/prompts-tab"
import { UsersTab } from "@/components/admin/users-tab"
import { CopiedCaptionsTab } from "@/components/admin/copied-captions-tab"
import { UserSubscriptionTab } from "@/components/admin/user-subscription-tab"
import { SubscriptionTierTab } from "@/components/admin/subscription-tier-tab"
import { SiteControlsTab } from "@/components/admin/site-controls-tab"
import { ScraperDataTab } from "@/components/admin/scraper-data-tab"
import { VisitsTab } from "@/components/admin/visits-tab"
import s from "@/styles/scraper.module.css"

type Prompt = {
  id: number
  name: string
  prompt_text: string
  description: string
  documents: Document[]
}

type Document = {
  id: number
  filename: string
  originalFilename: string
  cloudinaryUrl: string
  fileType: string
  fileSize: number
  createdAt: string
}

type User = {
  id: number
  email: string
  username?: string | null
  is_admin: boolean
  email_verified: boolean
  created_at: string
  post_count: number
  copied_count: number
  banned_id: number | null
  ban_reason: string | null
  banned_at: string | null
}

type CopiedCaption = {
  id: number
  caption_text: string
  copied_at: string
  user_email: string
  post_name: string
}

export default function AdminPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [copiedCaptions, setCopiedCaptions] = useState<CopiedCaption[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string>("caption_generator")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [showSavedSuccess, setShowSavedSuccess] = useState(false)
  const [savingUsername, setSavingUsername] = useState<Record<number, boolean>>({})
  const [banner, setBanner] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const bannerTimerRef = useRef<number | null>(null)

  const showBanner = (text: string, kind: "ok" | "err" = "ok") => {
    setBanner({ text, kind })
    if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = window.setTimeout(() => setBanner(null), 2000)
  }

  useEffect(() => () => { if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current) }, [])

  useEffect(() => {
    const token = localStorage.getItem("token")
    const userData = localStorage.getItem("user")
    console.log("Admin Page - Token exists:", !!token)
    console.log("Admin Page - User data:", userData)
    if (userData) {
      const parsedUser = JSON.parse(userData)
      console.log("Admin Page - Parsed user:", parsedUser)
      console.log("Admin Page - isAdmin value:", parsedUser.isAdmin)
    }

    if (!token) {
      router.push("/login")
      return
    }

    fetchData()
  }, [router])

  const fetchData = async () => {
    const token = localStorage.getItem("token")
    if (!token) return

    try {
      setIsLoading(true)
      const [promptsRes, usersRes, captionsRes] = await Promise.all([
        fetch("/api/admin/prompts", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/users", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/admin/copied-captions", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!promptsRes.ok || !usersRes.ok || !captionsRes.ok) {
        if (promptsRes.status === 403 || usersRes.status === 403 || captionsRes.status === 403) {
          toast({
            title: "Access Denied",
            description: "You don't have admin privileges",
            variant: "destructive",
          })
          router.push("/")
          return
        }
        throw new Error("Failed to fetch data")
      }

      const promptsData = await promptsRes.json()
      const usersData = await usersRes.json()
      const captionsData = await captionsRes.json()

      setPrompts(promptsData.prompts)
      setUsers(usersData.users)
      setCopiedCaptions(captionsData.copiedCaptions)
    } catch (error: any) {
      console.error("Error fetching data:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to load data",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handlePromptChange = (promptName: string) => {
    setSelectedPrompt(promptName)
    setShowSavedSuccess(false)
  }

  const handleSavePrompt = async (promptText: string) => {
    const token = localStorage.getItem("token")
    if (!token) {
      toast({
        title: "Error",
        description: "Authentication token missing",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    setShowSavedSuccess(false)
    try {
      const response = await fetch("/api/admin/prompts", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: selectedPrompt,
          promptText,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to save prompt")
      }

      const updatedPromptData = await response.json()
      const updatedPrompt = updatedPromptData.prompt

      setPrompts((prevPrompts) =>
        prevPrompts.map((p) =>
          p.name === selectedPrompt
            ? { ...p, prompt_text: updatedPrompt.prompt_text, description: updatedPrompt.description }
            : p,
        ),
      )

      toast({
        title: "Prompt Saved",
        description: `Prompt "${selectedPrompt}" has been successfully saved`,
        variant: "default",
        duration: 5000,
      })

      setShowSavedSuccess(true)
      setTimeout(() => setShowSavedSuccess(false), 3000)
    } catch (error: any) {
      console.error("Error saving prompt:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to save prompt",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleFileUpload = async (files: FileList) => {
    const token = localStorage.getItem("token")
    if (!token) {
      toast({
        title: "Error",
        description: "Authentication token missing",
        variant: "destructive",
      })
      return
    }

    setUploadingFile(true)

    const fileArray = Array.from(files)
    let successCount = 0
    let failCount = 0

    try {
      for (const file of fileArray) {
        try {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("promptName", selectedPrompt)

          const response = await fetch("/api/admin/documents", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || "Failed to upload document")
          }

          successCount++
        } catch (error: any) {
          console.error(`Error uploading ${file.name}:`, error)
          failCount++
        }
      }

      if (successCount > 0 && failCount === 0) {
        toast({
          title: "Success",
          description: `${successCount} document${successCount > 1 ? "s" : ""} uploaded successfully`,
          duration: 5000,
        })
      } else if (successCount > 0 && failCount > 0) {
        toast({
          title: "Partial Success",
          description: `${successCount} uploaded, ${failCount} failed`,
          variant: "destructive",
          duration: 5000,
        })
      } else {
        toast({
          title: "Error",
          description: "All uploads failed",
          variant: "destructive",
          duration: 5000,
        })
      }

      await fetchData()
    } finally {
      setUploadingFile(false)
    }
  }

  const handleDeleteDocument = async (documentId: number) => {
    const token = localStorage.getItem("token")
    if (!token) {
      toast({
        title: "Error",
        description: "Authentication token missing",
        variant: "destructive",
      })
      return
    }

    if (!confirm("Are you sure you want to delete this document?")) return

    try {
      const response = await fetch(`/api/admin/documents?id=${documentId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to delete document")
      }

      toast({
        title: "Success",
        description: "Document deleted successfully",
        duration: 5000,
      })

      await fetchData()
    } catch (error: any) {
      console.error("Error deleting document:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to delete document",
        variant: "destructive",
      })
    } finally {
      setUploadingFile(false)
    }
  }

  const handleBanUser = async (userId: number, currentlyBanned: boolean) => {
    const token = localStorage.getItem("token")
    if (!token) {
      toast({
        title: "Error",
        description: "Authentication token missing",
        variant: "destructive",
      })
      return
    }

    try {
      if (currentlyBanned) {
        const response = await fetch(`/api/admin/users/ban?id=${userId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to unban user")
        }

        toast({
          title: "Success",
          description: "User unbanned successfully",
          duration: 5000,
        })
      } else {
        const reason = prompt("Enter ban reason (optional):")

        const response = await fetch("/api/admin/users/ban", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId, reason }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to ban user")
        }

        toast({
          title: "Success",
          description: "User banned successfully",
          duration: 5000,
        })
      }

      await fetchData()
    } catch (error: any) {
      console.error("Error managing user ban:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to update user ban status",
        variant: "destructive",
      })
    }
  }

  const handleDeleteUser = async (userId: number) => {
    const token = localStorage.getItem("token")
    if (!token) {
      toast({
        title: "Error",
        description: "Authentication token missing",
        variant: "destructive",
      })
      return
    }

    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return

    try {
      const response = await fetch(`/api/admin/users?id=${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to delete user")
      }

      toast({
        title: "Success",
        description: "User deleted successfully",
        duration: 5000,
      })

      await fetchData()
    } catch (error: any) {
      console.error("Error deleting user:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      })
    }
  }

  const handleUpdateUsername = async (userId: number, username: string | null) => {
    const token = localStorage.getItem("token")
    if (!token) {
      toast({ title: "Error", description: "Authentication token missing", variant: "destructive" })
      return
    }
    setSavingUsername(prev => ({ ...prev, [userId]: true }))
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, username }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || "Failed to update username")
      }
      const data = await res.json().catch(() => ({}))
      const newName = (data?.user?.username ?? username) as string | null

      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, username: newName } : u)))
      toast({ title: "Saved", description: "Username updated" })
      showBanner("Username updated!", "ok")
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update username", variant: "destructive" })
      showBanner(err.message || "Failed to update username", "err")
    } finally {
      setSavingUsername(prev => ({ ...prev, [userId]: false }))
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex items-center justify-center gap-3 flex-col text-center">
          <div className="relative">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-primary-foreground bg-primary animate-bounce">
              <Users className="w-6 h-6" />
            </div>
            <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse" />
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen bg-background ${s.bgPattern}`}>
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">Admin Panel</h1>
          <p className="text-muted-foreground">Manage prompts, documents, users, and analytics</p>
        </div>

        <Tabs defaultValue="prompts" className="space-y-6">
          <TabsList className="flex w-full items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-1 lg:justify-between lg:overflow-visible lg:px-1">
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="prompts">Prompts & Docs</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="users">Users</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="subscriptions">User Subscription</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="tiers">Subscription Tier</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="analytics">Copied Captions</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="visits">Website Visits</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="site_controls">Site Controls</TabsTrigger>
            <TabsTrigger className="flex-none px-4 lg:flex-1 lg:justify-center" value="scraper_data">Scraper Data</TabsTrigger>
          </TabsList>

          <TabsContent value="prompts" className="space-y-6">
            <PromptsTab
              prompts={prompts}
              selectedPrompt={selectedPrompt}
              onPromptChange={handlePromptChange}
              onSave={handleSavePrompt}
              onFileUpload={handleFileUpload}
              onDeleteDocument={handleDeleteDocument}
              isSaving={isSaving}
              uploadingFile={uploadingFile}
              showSavedSuccess={showSavedSuccess}
            />
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <UsersTab
              users={users}
              onBanUser={handleBanUser}
              onDeleteUser={handleDeleteUser}
              onUpdateUsername={handleUpdateUsername}
              disabled={isSaving || uploadingFile}
              savingMap={savingUsername}
            />
          </TabsContent>

          <TabsContent value="subscriptions" className="space-y-4">
            <UserSubscriptionTab />
          </TabsContent>

          <TabsContent value="tiers" className="space-y-4">
            <SubscriptionTierTab />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <CopiedCaptionsTab copiedCaptions={copiedCaptions} />
          </TabsContent>

          <TabsContent value="visits" className="space-y-4">
            <VisitsTab />
          </TabsContent>

          <TabsContent value="site_controls" className="space-y-4">
            <SiteControlsTab />
          </TabsContent>

          <TabsContent value="scraper_data" className="space-y-4">
            <ScraperDataTab />
          </TabsContent>
        </Tabs>

        {banner && (
          <div
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-3 py-2 text-sm rounded-md shadow-lg
      ${banner.kind === "ok" ? "bg-foreground text-background" : "bg-rose-600 text-white"}`}
            role="status"
            aria-live="polite"
          >
            {banner.text}
          </div>
        )}
      </div>
    </div>
  )
}
