import { query } from "@/lib/db"

// Read-only compatibility check: deploys remain usable before the additive
// migration, with no schema writes or per-visit DDL on a public endpoint.
let cached: { enabled: boolean; expiresAt: number } | undefined
let pending: Promise<boolean> | undefined

export async function visitIdentityEnabled(): Promise<boolean> {
  if (cached && cached.expiresAt > Date.now()) return cached.enabled
  if (pending) return pending
  pending = query<{ count: number }>(`
    SELECT COUNT(*) AS count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'website_visits' AND COLUMN_NAME = 'user_id'
  `).then(rows => {
    const enabled = Number(rows[0]?.count || 0) > 0
    cached = { enabled, expiresAt: Date.now() + 60_000 }
    return enabled
  }).finally(() => { pending = undefined })
  return pending
}
