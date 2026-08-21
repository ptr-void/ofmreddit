import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function GET(req: Request) {
  try {
    const pending = await query("SELECT * FROM master_subreddits WHERE status = 'pending' ORDER BY created_at DESC");
    return NextResponse.json({ subreddits: pending })
  } catch (err) {
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { id, action } = await req.json()
    
    if (action === "approve") {
      await query("UPDATE master_subreddits SET status = 'approved' WHERE id = ?", [id])
    } else if (action === "reject") {
      await query("UPDATE master_subreddits SET status = 'rejected' WHERE id = ?", [id])
    }
    
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: "Server Error" }, { status: 500 })
  }
}
