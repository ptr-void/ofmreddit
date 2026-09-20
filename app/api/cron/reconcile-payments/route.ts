import { NextResponse } from "next/server"
import { reconcilePendingPayments } from "@/lib/binance-payments"

export const preferredRegion = "sin1"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await reconcilePendingPayments()) })
  } catch (error) {
    console.error("Payment reconciliation error:", error)
    return NextResponse.json({ error: "Payment reconciliation failed" }, { status: 502 })
  }
}
