"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import SubscriptionTiers from "@/components/subscription/tiers"
import { Button } from "@/components/ui/button"

export default function SubscriptionsPage() {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!localStorage.getItem("token")) router.replace("/login")
  }, [router])

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4 py-12">
      <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold">Subscription Plans</h1>
        <p className="mt-3 text-muted-foreground">Manage the active plan or pay securely with USDT on TRC20.</p>
        <Button className="mt-6" onClick={() => setOpen(true)}>View plans</Button>
      </div>
      <SubscriptionTiers open={open} onClose={() => setOpen(false)} />
    </main>
  )
}
