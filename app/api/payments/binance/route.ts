import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { createPaymentIntent, getAndReconcilePaymentIntent } from "@/lib/binance-payments"

function currentUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  return token ? verifyToken(token) : null
}

export async function POST(req: Request) {
  const user = currentUser(req)
  if (!user?.userId) return NextResponse.json({ error: "Sign in to start a payment" }, { status: 401 })
  try {
    const { tierId } = await req.json()
    if (!Number.isSafeInteger(Number(tierId)) || Number(tierId) <= 0) {
      return NextResponse.json({ error: "Invalid subscription tier" }, { status: 400 })
    }
    return NextResponse.json({ payment: await createPaymentIntent(user.userId, Number(tierId)) })
  } catch (error: any) {
    console.error("Payment intent error:", error)
    const message = error?.message || "Payment request could not be created"
    const status = /not found|price yet/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function GET(req: Request) {
  const user = currentUser(req)
  if (!user?.userId) return NextResponse.json({ error: "Sign in to check a payment" }, { status: 401 })
  const id = new URL(req.url).searchParams.get("id") || ""
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid payment request" }, { status: 400 })
  try {
    return NextResponse.json({ payment: await getAndReconcilePaymentIntent(user.userId, id) })
  } catch (error: any) {
    console.error("Payment check error:", error)
    const message = error?.message || "Payment could not be checked"
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 502 })
  }
}
