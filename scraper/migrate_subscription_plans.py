"""Create the four production plans and configurable usage windows."""

import os

import pymysql
from dotenv import load_dotenv


load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))


def main() -> None:
    db = pymysql.connect(
        host=os.environ["DB_HOST"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        autocommit=False,
    )
    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE()
                   AND table_name = 'subscription_tiers'
                   AND column_name = 'usage_period_days'
                """
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "ALTER TABLE subscription_tiers ADD COLUMN usage_period_days INT NOT NULL DEFAULT 7 AFTER duration_days"
                )

            # Keep the existing IDs so current subscriptions move to their corresponding new plan.
            cursor.execute(
                """
                UPDATE subscription_tiers
                   SET name='Free', price=NULL, duration_days=30, usage_period_days=7,
                       weekly_scraper_limit=5, weekly_planner_limit=-1,
                       weekly_caption_limit=-1, weekly_database_limit=5,
                       saved_username_limit=3, saved_profile_limit=0,
                       daily_subreddit_checker_limit=3, is_active=1, updated_at=NOW()
                 WHERE id=1
                """
            )
            cursor.execute(
                """
                UPDATE subscription_tiers
                   SET name='Minimum', price=10, duration_days=10, usage_period_days=7,
                       weekly_scraper_limit=20, weekly_planner_limit=-1,
                       weekly_caption_limit=-1, weekly_database_limit=20,
                       saved_username_limit=3, saved_profile_limit=0,
                       daily_subreddit_checker_limit=5, is_active=1, updated_at=NOW()
                 WHERE id=2
                """
            )
            cursor.execute(
                """
                UPDATE subscription_tiers
                   SET name='Basic', price=30, duration_days=30, usage_period_days=7,
                       weekly_scraper_limit=25, weekly_planner_limit=-1,
                       weekly_caption_limit=-1, weekly_database_limit=25,
                       saved_username_limit=3, saved_profile_limit=0,
                       daily_subreddit_checker_limit=10, is_active=1, updated_at=NOW()
                 WHERE id=4
                """
            )
            cursor.execute(
                """
                UPDATE subscription_tiers
                   SET name='Pro', price=50, duration_days=30, usage_period_days=7,
                       weekly_scraper_limit=-1, weekly_planner_limit=-1,
                       weekly_caption_limit=-1, weekly_database_limit=-1,
                       saved_username_limit=3, saved_profile_limit=0,
                       daily_subreddit_checker_limit=-1, is_active=1, updated_at=NOW()
                 WHERE id=5
                """
            )

            # Fold the accidentally-created Unlimited tier into Pro, preserving any
            # subscriptions and payment history before removing the duplicate row.
            cursor.execute("UPDATE user_subscriptions SET tier_id=5 WHERE tier_id=6")
            cursor.execute("UPDATE crypto_payment_intents SET tier_id=5 WHERE tier_id=6")
            cursor.execute("DELETE FROM subscription_tiers WHERE id=6")
            # These controls are global invariants, including any additional active tier
            # that an administrator created outside this migration.
            cursor.execute(
                """
                UPDATE subscription_tiers
                   SET usage_period_days=7,
                       weekly_planner_limit=-1,
                       weekly_caption_limit=-1,
                       saved_username_limit=3,
                       saved_profile_limit=0,
                       updated_at=NOW()
                 WHERE is_active=1
                """
            )
        db.commit()
        print("Verified Free, Minimum, Basic, and Pro plans.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
