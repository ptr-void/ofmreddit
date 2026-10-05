import { queryOne } from "@/lib/db"

export const CAPTION_PAUSED_MESSAGE = "Caption generation is temporarily paused by the admin. Your inputs are unchanged."

export async function readCaptionAccess() {
  const column = await queryOne<{ count: number }>(`
    SELECT COUNT(*) AS count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_controls' AND COLUMN_NAME = 'caption_generation_enabled'
  `)
  const configured = Number(column?.count || 0) > 0
  const row = configured ? await queryOne<{ caption_generation_enabled: number }>(
    "SELECT caption_generation_enabled FROM site_controls WHERE id = 1 LIMIT 1",
  ) : null
  // Preserve existing access before the additive migration. Never cache the
  // switch: the next request must observe a saved pause, including old tabs.
  return { enabled: row ? Number(row.caption_generation_enabled) === 1 : true, configured }
}

export async function captionAccessForUser(userId: number) {
  const account = await queryOne<{ is_admin: number }>("SELECT is_admin FROM users WHERE id = ? LIMIT 1", [userId])
  const state = await readCaptionAccess()
  const isAdmin = Number(account?.is_admin) === 1
  return { ...state, isAdmin, allowed: Boolean(account) && (state.enabled || isAdmin) }
}
