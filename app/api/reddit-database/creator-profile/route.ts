import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { getActiveTierForUser, listSavedProfiles, saveProfileWithPrune, deleteProfile } from "@/lib/limits"

function getUserId(req: Request) {
  const h = req.headers.get("authorization") || ""
  const tok = h.replace(/^Bearer\s+/i, "")
  if (!tok) return null
  const me = verifyToken(tok)
  return (me as any)?.userId ?? (me as any)?.id
}

export async function GET(req: Request) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const profiles = await listSavedProfiles(userId)
    return NextResponse.json({ profiles })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { name, profile } = await req.json()
    
    // Check if user is at limit before saving
    const tier = await getActiveTierForUser(userId)
    const profiles = await listSavedProfiles(userId)
    const cap = tier?.saved_profile_limit ?? 0

    if (cap > 0 && profiles.length >= cap) {
      // Check if we are updating an existing one (by name)
      const exists = profiles.some(p => p.name.toLowerCase() === name.toLowerCase())
      if (!exists) {
        return NextResponse.json({ 
          error: "Profile limit reached", 
          code: "LIMIT_REACHED",
          cap 
        }, { status: 429 })
      }
    }

    await saveProfileWithPrune(userId, name, profile)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 })

  try {
    await deleteProfile(userId, parseInt(id))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}