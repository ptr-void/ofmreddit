"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { CaptionForm } from "@/components/caption-generator/caption-form"
import { PostsList } from "@/components/caption-generator/posts-list"
import { CaptionResults } from "@/components/caption-generator/caption-results"
import { AiBotStatus } from "@/components/caption-generator/ai-bot-status"
import { useToast } from "@/hooks/use-toast"
import { Bot, ThumbsUp, Sparkles } from "lucide-react"
import s from "@/styles/scraper.module.css"

export type Post = {
  id: string
  name: string
  captions?: Caption[]
}

export type Caption = {
  option: number
  text: string
}

export type FormData = {
  mode: "keywords" | "advanced" | "quick"
  physicalFeatures: string
  gender: "female" | "male" | "trans"
  subredditType: "generalist" | "body-specific" | "kink-specific" | "aesthetic"
  visualContext: string
  degenScale: number
  captionMood: string
  rules: string
  creativeStyle: string
  isInteractive: boolean
  subredditName: string
  contentType: string
}

export default function CaptionGeneratorPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [posts, setPosts] = useState<Post[]>([])
  const [selectedPostId, setSelectedPostId] = useState<string>("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState<string>(
    "Let's get creative! Choose the mode below and let's get going.",
  )
  const [showSuccess, setShowSuccess] = useState(false)

  const selectedPost = posts.find((p) => p.id === selectedPostId)

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) {
      router.push("/login")
      return
    }

    const fetchPosts = async () => {
      try {
        console.log("Fetching posts...")
        const response = await fetch("/api/posts", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error("Failed to fetch posts:", response.status, errorData)
          throw new Error(errorData.error || `Failed to fetch posts (${response.status})`)
        }

        const data = await response.json()
        console.log("Fetched posts:", data.posts)

        if (!data.posts || data.posts.length === 0) {
          console.log("No posts found, creating default post...")
          await createDefaultPost(token)
          return
        }

        const sortedPosts = [...data.posts].sort((a, b) => Number.parseInt(a.id) - Number.parseInt(b.id))
        setPosts(sortedPosts)
        if (sortedPosts.length > 0) {
          setSelectedPostId(sortedPosts[0].id)
        }
      } catch (error: any) {
        console.error("Error fetching posts:", error)
        setError(error.message)
      } finally {
        setIsLoading(false)
      }
    }

    const createDefaultPost = async (token: string) => {
      try {
        const response = await fetch("/api/posts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: "Post 1" }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `HTTP ${response.status}`)
        }

        const data = await response.json()
        console.log("Created default post:", data.post)
        setPosts([data.post])
        setSelectedPostId(data.post.id)
      } catch (error: any) {
        console.error("Error creating default post:", error)
        setError(error.message)
      }
    }

    fetchPosts()
  }, [router])

  const handleAddPost = async () => {
    const token = localStorage.getItem("token")
    if (!token) return

    try {
      const newPostName = `Post ${posts.length + 1}`
      console.log("Creating new post:", newPostName)
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newPostName }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      console.log("Created post:", data.post)
      const updatedPosts = [...posts, data.post].sort((a, b) => Number.parseInt(a.id) - Number.parseInt(b.id))
      setPosts(updatedPosts)
      setSelectedPostId(data.post.id)
      setError(null)
    } catch (error: any) {
      console.error("Error creating post:", error)
      setError(error.message)
    }
  }

  const handleGenerateCaptions = async (formData: FormData) => {
    const token = localStorage.getItem("token")
    if (!token) return

    setIsGenerating(true)
    setError(null)
    setShowSuccess(false)
    setAiMessage("Processing your request... Crafting some steamy captions for you!")
    try {
      const response = await fetch("/api/caption-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: `Caption service returned HTTP ${response.status}.`,
          retryable: [429, 502, 503, 504].includes(response.status),
        }))
        const message = errorData.error || `HTTP ${response.status}`
        if (errorData.code === "CONTENT_BLOCKED") {
          setError(message)
          setAiMessage("Gemini blocked this request. Your inputs are kept; repeating the same request is not an outage fix.")
          return
        }
        if (errorData.code === "INVALID_CAPTION_OUTPUT" || errorData.code === "GENERATION_INCOMPLETE") {
          setError(message)
          setAiMessage("Gemini returned no complete caption set. Your inputs are unchanged.")
          return
        }
        if (errorData.code === "DAILY_QUOTA_EXHAUSTED") {
          const retryAt = errorData.retryAvailableAt ? new Date(errorData.retryAvailableAt) : null
          setError(`${message}${retryAt && Number.isFinite(retryAt.getTime()) ? ` Google's reported retry time: ${retryAt.toLocaleString()}.` : ""}`)
          setAiMessage("Daily Gemini API quota reached. Your inputs are kept; a short retry will not help.")
          return
        }
        if (errorData.retryable || [429, 503, 504].includes(response.status)) {
          setError(`${message} Retry in ${errorData.retryAfterSeconds || 10} seconds; your inputs are unchanged.`)
          setAiMessage("The caption service is temporarily unavailable. Your inputs are kept; retry shortly.")
          return
        }
        throw new Error(message)
      }

      const data = await response.json()
      if (!data.captions) {
        throw new Error("No captions returned from server")
      }

      setPosts(posts.map((post) => (post.id === selectedPostId ? { ...post, captions: data.captions } : post)))
      setAiMessage("Captions generated! Check them out on the right.")

      setShowSuccess(true)
      toast({
        title: "Success!",
        description: "Your captions are ready to use.",
        duration: 3000,
      })
    } catch (error: any) {
      setError(error.message || "Failed to generate captions. Please try again.")
      setAiMessage("Caption generation failed. Your inputs are unchanged; see the error above.")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleClearCaptions = () => {
    console.log("Clearing captions for post:", selectedPostId)
    setPosts(posts.map((post) => (post.id === selectedPostId ? { ...post, captions: [] } : post)))
    setAiMessage("Captions cleared! Ready to generate new ones.")
  }

  const handleRemovePost = async (postId: string) => {
    const token = localStorage.getItem("token")
    if (!token) return

    if (posts.length === 1) {
      setError("Cannot remove the last post")
      return
    }

    try {
      console.log("Removing post:", postId)
      const response = await fetch(`/api/posts?id=${postId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const updatedPosts = posts.filter((post) => post.id !== postId)
      setPosts(updatedPosts)

      if (selectedPostId === postId && updatedPosts.length > 0) {
        setSelectedPostId(updatedPosts[0].id)
      }

      setError(null)
      console.log("Post removed successfully")
    } catch (error: any) {
      console.error("Error removing post:", error)
      setError(error.message)
    }
  }

  if (isLoading) {
    return (
      <div className={`min-h-screen ${s.bgPattern} text-foreground flex items-center justify-center`}>
        <div className="flex items-center justify-center gap-3 flex-col text-center">
          <div className="relative">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-primary-foreground bg-primary animate-bounce">
              <Bot className="w-6 h-6" />
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
    <div className={`min-h-screen ${s.bgPattern} text-foreground`}>
      <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_560px] gap-0 min-h-[calc(100vh-73px)]">
        <div className="lg:border-r lg:border-border">
          <PostsList
            posts={posts}
            selectedPostId={selectedPostId}
            onSelectPost={setSelectedPostId}
            onAddPost={handleAddPost}
            onRemovePost={handleRemovePost}
          />
        </div>

        <div className="lg:border-r lg:border-border overflow-y-auto">
          <div className="p-4 md:p-6">
            {error && <div role="alert" className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>}

            <AiBotStatus isGenerating={isGenerating} message={aiMessage} showSuccess={showSuccess} />

            <CaptionForm
              key={selectedPostId}
              onGenerate={handleGenerateCaptions}
              isGenerating={isGenerating}
            />
          </div>
        </div>

        <div className="overflow-y-auto">
          <CaptionResults posts={posts} selectedPostId={selectedPostId} onClearCaptions={handleClearCaptions} />
        </div>
      </div>
    </div>
  )
}
