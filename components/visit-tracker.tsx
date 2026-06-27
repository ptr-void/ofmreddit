"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

export function VisitTracker() {
  const pathname = usePathname()

  useEffect(() => {
    // Only track if pathname is available
    if (!pathname) return

    // Don't track admin routes to keep data clean
    if (pathname.startsWith("/admin") || pathname.startsWith("/api")) return

    const trackVisit = async () => {
      try {
        await fetch("/api/track-visit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pagePath: pathname }),
          // We use keepalive so the request finishes even if the user navigates away
          keepalive: true, 
        })
      } catch (error) {
        // Silently fail, tracking shouldn't break the app
        console.error("Visit tracking failed:", error)
      }
    }

    // Small delay to ensure page is loaded and avoid rapid double-tracking during hydration
    const timer = setTimeout(() => {
      trackVisit()
    }, 1000)

    return () => clearTimeout(timer)
  }, [pathname])

  // This component doesn't render anything
  return null
}
