"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import SubscriptionTiers from "@/components/subscription/tiers"
import s from "@/styles/scraper.module.css"

export default function SubscriptionsPage() {
  const router = useRouter()
  useEffect(() => {
    if (!localStorage.getItem("token")) router.replace("/login")
  }, [router])

  return (
    <main className={`min-h-screen bg-background py-6 ${s.bgPattern}`}>
      <SubscriptionTiers embedded open onClose={() => undefined} />
    </main>
  )
}
