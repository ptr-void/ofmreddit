"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import SubscriptionTiers from "@/components/subscription/tiers"

export default function SubscriptionsPage() {
  const router = useRouter()
  useEffect(() => {
    if (!localStorage.getItem("token")) router.replace("/login")
  }, [router])

  return (
    <main className="min-h-[70vh] py-6">
      <SubscriptionTiers embedded open onClose={() => undefined} />
    </main>
  )
}
