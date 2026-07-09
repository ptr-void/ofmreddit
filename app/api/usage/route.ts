import { NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { queryOne } from "@/lib/db"
import { assertWithinLimits, assertCooldown, recordUsage, listSavedScrapes, loadSavedScrape, saveSnapshotWithPrune, deleteSaved, assertDailySiteLimit } from "@/lib/limits"

function tokenFromReq(req: Request): string | null {
    const h = req.headers.get("authorization") || ""
    const m = /^Bearer\s+(.+)$/i.exec(h)
    if (m?.[1]) return m[1]
    const ck = req.headers.get("cookie") || ""
    const part = ck.split(";").map(s => s.trim()).find(s => s.startsWith("token="))
    return part ? decodeURIComponent(part.split("=").slice(1).join("=")) : null
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const feature = body?.feature
        const op = body?.op
        const meta = body?.meta
        if (!feature || !["scraper", "post_planner", "caption_gen", "database", "subreddit_checker"].includes(feature)) {
            return NextResponse.json({ error: "Invalid feature" }, { status: 400 })
        }

        const tok = tokenFromReq(req)
        if (!tok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        const me = verifyToken(tok)
        const userId = (me as any)?.userId ?? (me as any)?.id
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const site = await queryOne<{ show_sub: number }>(
            "SELECT show_sub FROM site_controls WHERE id = 1 LIMIT 1",
            [],
        )
        const showTiersFlag = site ? !!Number(site.show_sub) : true

        /*
        if (body?.debug === "site") {
            const rawShowSub = site?.show_sub
            const numShowSub =
                rawShowSub === null || rawShowSub === undefined
                    ? NaN
                    : typeof rawShowSub === "number"
                        ? rawShowSub
                        : Number(rawShowSub)

            return NextResponse.json({
                debug: true,
                siteExists: !!site,
                rawShowSub,
                rawType: typeof rawShowSub,
                numShowSub,
                finalFlag: site ? !!numShowSub : true,
            })
        }
        */
        if (op === "check") {
            const sub = await queryOne<{ tier_id: number; cooldown: string }>(
                `SELECT tier_id, cooldown FROM user_subscriptions 
         WHERE user_id = ? 
         AND (ends_at IS NULL OR ends_at > NOW()) 
         ORDER BY created_at DESC LIMIT 1`,
                [userId]
            )

            /*
            if (!sub || sub.tier_id === 1) {
                return NextResponse.json({ error: "No active subscription." }, { status: 403 })
            }
            */

            let within: any
            if (feature === "subreddit_checker") {
                within = await assertDailySiteLimit(userId, feature)
            } else {
                within = await assertWithinLimits(userId, feature)
            }
            if (!within.ok) {
                const anyWithin: any = within
                if (anyWithin.code === "NO_ACCESS") {
                    return NextResponse.json({ error: "This feature is not available for your plan.", showTiers: showTiersFlag }, { status: 403 })
                }
                if (anyWithin.code === "WEEKLY_LIMIT") {
                    const timeWindow = feature === "subreddit_checker" ? "Daily" : "Weekly"
                    const perTime = feature === "subreddit_checker" ? "day" : "week"
                    return NextResponse.json(
                        { 
                          error: `${timeWindow} limit reached (${anyWithin.cap} uses per ${perTime}).`, 
                          showTiers: showTiersFlag,
                          usage: anyWithin.weekly,
                          cap: anyWithin.cap
                        },
                        { status: 429 }
                    )
                }
            }

            if (feature === "scraper") {
                const coolMinutes = Number(sub?.cooldown ?? 0)
                const cool = await assertCooldown(userId, "scraper", isNaN(coolMinutes) ? 30 : coolMinutes)
                if (!cool.ok) {
                    return NextResponse.json({ error: `Scrape cooldown. Try again in ~${cool.wait} min.` }, { status: 429 })
                }
            }

            return NextResponse.json({ ok: true, usage: within?.usage, cap: within?.cap })
        }

        if (op === "record") {
            await recordUsage(userId, feature, meta || null)
            return NextResponse.json({ ok: true })
        }

        if (feature === "scraper" && op === "list_saved") {
            const items = await listSavedScrapes(userId)
            return NextResponse.json({ items })
        }

        if (feature === "scraper" && op === "load_saved") {
            const username = String(body?.username || "")
            if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 })
            const payloadRaw = await loadSavedScrape(userId, username)
            if (!payloadRaw) return NextResponse.json({ error: "Not found" }, { status: 404 })
            const payload = typeof payloadRaw === "string" ? JSON.parse(payloadRaw) : payloadRaw
            return NextResponse.json({ payload })
        }

        if (feature === "scraper" && op === "save_snapshot") {
            const username = String(body?.username || "")
            if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 })
            const items = await saveSnapshotWithPrune(userId, username, body?.payload ?? {})
            return NextResponse.json({ ok: true, items })
        }

        if (feature === "scraper" && op === "delete_saved") {
            const username = String(body?.username || "")
            if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 })
            await deleteSaved(userId, username)
            const items = await listSavedScrapes(userId)
            return NextResponse.json({ ok: true, items })
        }

        return NextResponse.json({ error: "Invalid op" }, { status: 400 })
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 })
    }
}
