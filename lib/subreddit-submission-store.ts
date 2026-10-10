import { getPool } from "@/lib/db"
import type { SubmissionResult } from "@/lib/subreddit-submissions"

/** One transaction per name: attribution and the review item succeed together. */
export async function queueSubredditSubmission(name: string, tags: string, subscribers: number, userId: number): Promise<SubmissionResult["status"]> {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const [maintenance]: any = await connection.execute(
      "SELECT state FROM subreddit_maintenance WHERE subreddit_name = ? FOR UPDATE", [name])
    if (maintenance[0]?.state === "archived") {
      await connection.rollback()
      return "archived"
    }
    await connection.execute(`INSERT INTO master_subreddits (subreddit_name, niche_tags, is_nsfw, status, subscribers)
      VALUES (?, ?, 1, 'pending', ?)
      ON DUPLICATE KEY UPDATE
        niche_tags = IF(status = 'pending' AND TRIM(COALESCE(niche_tags, '')) = '', VALUES(niche_tags), niche_tags)`,
      [name, tags, subscribers])
    const [masters]: any = await connection.execute(
      "SELECT status FROM master_subreddits WHERE LOWER(subreddit_name) = ? FOR UPDATE", [name])
    if (!masters.length) throw new Error("Submission row readback failed")
    if (masters[0]?.status !== "pending") {
      await connection.rollback()
      return masters[0]?.status === "rejected" ? "rejected" : "existing"
    }
    const [attempts]: any = await connection.execute(
      "SELECT user_id FROM subreddit_submission_attempts WHERE subreddit_name = ? AND user_id = ?", [name, userId])
    await connection.execute(`INSERT INTO subreddit_submission_attempts (subreddit_name, user_id, source, niche_tags)
      VALUES (?, ?, 'database', ?)
      ON DUPLICATE KEY UPDATE source = VALUES(source), niche_tags = VALUES(niche_tags), updated_at = CURRENT_TIMESTAMP`,
      [name, userId, tags])
    await connection.commit()
    return attempts.length ? "pending" : "submitted"
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
}
