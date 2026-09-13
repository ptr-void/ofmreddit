import { NextResponse } from "next/server"
import { getNichePresets } from "@/lib/niche-presets"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const niches = await getNichePresets()
    return NextResponse.json(
      { niches },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
    )
  } catch (error) {
    console.error("Niche preset read error:", error)
    return NextResponse.json({ error: "Niche presets are temporarily unavailable" }, { status: 503 })
  }
}

