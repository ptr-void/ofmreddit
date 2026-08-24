import { query } from "../lib/db"

async function main() {
  try {
    console.log("Adding daily_subreddit_checker_limit to subscription_tiers...")
    await query("ALTER TABLE subscription_tiers ADD COLUMN daily_subreddit_checker_limit INT NOT NULL DEFAULT 5")
    console.log("Success!")
  } catch (e: any) {
    if (e.message.includes("Duplicate column name")) {
      console.log("Column daily_subreddit_checker_limit already exists.")
    } else {
      console.error(e)
    }
  }

  try {
    console.log("Adding custom_subreddit_checker_limit to users...")
    await query("ALTER TABLE users ADD COLUMN custom_subreddit_checker_limit INT NULL DEFAULT NULL")
    console.log("Success!")
  } catch (e: any) {
    if (e.message.includes("Duplicate column name")) {
      console.log("Column custom_subreddit_checker_limit already exists.")
    } else {
      console.error(e)
    }
  }
  
  process.exit(0)
}

main()
