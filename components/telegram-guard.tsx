"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { ShieldAlert, Send } from "lucide-react"
import s from "@/styles/scraper.module.css"

export function TelegramGuard() {
  const [show, setShow] = useState(false)
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const pathname = usePathname()
  const { toast } = useToast()

  // Wait for hydration and token check
  useEffect(() => {
    const checkAuth = () => {
      // Don't show on login/register pages
      if (pathname === "/login" || pathname === "/register" || pathname === "/") {
        setShow(false)
        return
      }

      const token = localStorage.getItem("token")
      const userStr = localStorage.getItem("user")

      if (!token || !userStr) {
        setShow(false)
        return
      }

      try {
        const user = JSON.parse(userStr)
        // If the user object doesn't have hasTelegramLinked (old user) 
        // or if it's explicitly false, show the modal
        if (!user.hasTelegramLinked) {
          setShow(true)
        } else {
          setShow(false)
        }
      } catch (e) {
        setShow(false)
      }
    }

    checkAuth()
    
    // Listen for storage changes in case they log out
    window.addEventListener("storage", checkAuth)
    return () => window.removeEventListener("storage", checkAuth)
  }, [pathname])

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return

    setLoading(true)
    try {
      const token = localStorage.getItem("token")
      const res = await fetch("/api/auth/link-telegram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ inviteCode: code.trim() })
      })

      const data = await res.json()

      if (res.ok && data.success) {
        // Update local storage
        localStorage.setItem("token", data.token)
        
        const userStr = localStorage.getItem("user")
        if (userStr) {
          const user = JSON.parse(userStr)
          user.hasTelegramLinked = true
          localStorage.setItem("user", JSON.stringify(user))
        }

        toast({
          title: "Telegram Verified!",
          description: "Your account is now linked. You can continue using the site.",
        })
        setShow(false)
      } else {
        toast({
          variant: "destructive",
          title: "Verification Failed",
          description: data.error || "Invalid invite code",
        })
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred",
      })
    } finally {
      setLoading(false)
    }
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md mx-4 rounded-xl border border-border shadow-2xl p-6 sm:p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
          <ShieldAlert className="w-8 h-8 text-primary" />
        </div>
        
        <h2 className="text-2xl font-bold mb-2">Verify Your Telegram</h2>
        <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
          To continue using OFMReddit, you must link your Telegram account. 
          Message the bot <strong className="text-foreground">@OFMReddit_RR_Bot</strong> with <strong className="text-foreground">/signup</strong> to get your verification code.
        </p>

        <form onSubmit={handleVerify} className="w-full flex flex-col gap-4">
          <input
            type="text"
            placeholder="Enter verification code..."
            className={`${s.csvinput} w-full text-center text-lg tracking-widest font-mono uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            required
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className={`${s.btn} w-full flex items-center justify-center gap-2 font-medium !py-3`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Verifying...
              </span>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Verify Account
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
