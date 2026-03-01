"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Menu, X, Sun, Moon, Shield } from "lucide-react"

const getInitialUser = () => {
  if (typeof window === "undefined") return null
  try {
    const token = localStorage.getItem("token")
    const userData = localStorage.getItem("user")
    console.log("Navigation - Token exists:", !!token)
    console.log("Navigation - User data:", userData)
    if (token && userData) {
      const parsedUser = JSON.parse(userData)
      console.log("Navigation - Parsed user:", parsedUser)
      console.log("Navigation - isAdmin value:", parsedUser.isAdmin)
      return parsedUser
    }
  } catch (error) {
    console.error("Failed to parse user data:", error)
    localStorage.removeItem("user")
    localStorage.removeItem("token")
  }
  return null
}

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(getInitialUser())
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const isDark = document.documentElement.classList.contains("dark")
    setTheme(isDark ? "dark" : "light")
  }, [])

  useEffect(() => {
    const checkAuth = () => {
      const token = localStorage.getItem("token")
      const userData = localStorage.getItem("user")
      if (token && userData) {
        try {
          setUser(JSON.parse(userData))
        } catch (error) {
          console.error("Failed to parse user data:", error)
          localStorage.removeItem("user")
          localStorage.removeItem("token")
          setUser(null)
        }
      } else {
        setUser(null)
      }
    }

    checkAuth()

    window.addEventListener("storage", checkAuth)

    window.addEventListener("authChange", checkAuth)

    return () => {
      window.removeEventListener("storage", checkAuth)
      window.removeEventListener("authChange", checkAuth)
    }
  }, [pathname])

  const handleLogout = () => {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    setUser(null)
    window.dispatchEvent(new Event("authChange"))
    router.push("/login")
  }

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light"
    setTheme(newTheme)
    localStorage.setItem("theme", newTheme)
    document.documentElement.classList.toggle("dark", newTheme === "dark")
  }

  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-1">
            {user && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden order-first p-2 rounded-lg hover:bg-muted transition-colors"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}

            <Link
              href="/"
              className="flex items-center gap-2 mr-4 order-last md:order-none"
            >
              <span className="text-xl font-bold text-foreground">OFMReddit</span>
            </Link>

            {user && (
              <>
                <Link
                  href="/scraper"
                  className={`hidden md:block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/scraper"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                >
                  Performance Analysis
                </Link>
                <Link
                  href="/post-planner"
                  className={`hidden md:block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/post-planner"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                >
                  Post Planner
                </Link>
                
                {user.isAdmin ? (
                  <>
                    <Link
                      href="/reddit-database"
                      className={`hidden md:block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/reddit-database"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                    >
                      Subreddit Database
                    </Link>
                    <Link
                      href="/caption-generator"
                      className={`hidden md:block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/caption-generator"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                    >
                      Caption Generator
                    </Link>
                    <Link
                      href="/admin"
                      className={`hidden md:flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/admin"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                    >
                      <Shield className="w-4 h-4" />
                      Admin
                    </Link>
                  </>
                ) : null}
              </>
            )}
          </div>


          <div className="flex items-center gap-4">
            {mounted && (
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
                title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              >
                {theme === "light" ? (
                  <Moon className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <Sun className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
            )}

            {user ? (
              <>
                <span className="hidden md:block text-sm text-muted-foreground truncate max-w-[150px]">
                  {user.email}
                </span>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  Logout
                </Button>
              </>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="outline" size="sm">
                    Login
                  </Button>
                </Link>
                <Link href="/register" className="hidden sm:block">
                  <Button size="sm">Register</Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {user && mobileMenuOpen && (
          <div className="md:hidden pb-4 space-y-2">
            <Link
              href="/scraper"
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/scraper"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
            >
              Performance Analysis
            </Link>
            <Link
              href="/post-planner"
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/post-planner"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
            >
              Post Planner
            </Link>
            
            {user.isAdmin ? (
              <>
                <Link
                  href="/reddit-database"
                  className={`hidden md:block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/reddit-database"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                >
                  Subreddit Database
                </Link>
                <Link
                  href="/caption-generator"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/caption-generator"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                >
                  Caption Generator
                </Link>
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${pathname === "/admin"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                >
                  <Shield className="w-4 h-4" />
                  Admin
                </Link>
              </>
            ) : null}
            <div className="px-4 py-2 text-sm text-muted-foreground border-t border-border mt-2 pt-4">{user.email}</div>
          </div>
        )}
      </div>
    </nav>
  )
}
