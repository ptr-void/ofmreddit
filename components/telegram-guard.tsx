"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

export function TelegramGuard() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const checkAuth = () => {
      // Don't intercept on auth pages or the verify page itself
      if (pathname === "/login" || pathname === "/register" || pathname === "/" || pathname === "/verify-telegram") {
        return
      }

      const token = localStorage.getItem("token")
      const userStr = localStorage.getItem("user")

      if (!token || !userStr) {
        return
      }

      try {
        const user = JSON.parse(userStr)
        // If the user object doesn't have hasTelegramLinked (old user) 
        // or if it's explicitly false, force them to the verification page
        if (!user.hasTelegramLinked) {
          router.replace("/verify-telegram")
        }
      } catch (e) {
        // ignore JSON parse errors
      }
    }

    checkAuth()
    
    // Listen for storage changes in case they log out
    window.addEventListener("storage", checkAuth)
    return () => window.removeEventListener("storage", checkAuth)
  }, [pathname, router])

  // This component renders nothing. It acts purely as a navigation guard.
  return null
}
