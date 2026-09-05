"""Add submitter attribution and one-time checker rewards; default is a read-only plan."""
import argparse

try:
    from scraper.migrate_schema import connection_config
except ModuleNotFoundError:
    from migrate_schema import connection_config


CREATE_ATTEMPTS = """CREATE TABLE IF NOT EXISTS subreddit_submission_attempts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    subreddit_name VARCHAR(64) NOT NULL,
    user_id INT NOT NULL,
    source VARCHAR(32) NOT NULL,
    niche_tags VARCHAR(500) NOT NULL,
    rewarded_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_submission_subreddit_user (subreddit_name, user_id),
    INDEX idx_submission_review (subreddit_name, rewarded_at),
    INDEX idx_submission_user (user_id)
) ENGINE=InnoDB"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    import mysql.connector
    connection = mysql.connector.connect(**connection_config())
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='users' AND COLUMN_NAME='subreddit_checker_credits'",
                (connection_config()['database'],),
            )
            has_credits = cursor.fetchone() is not None
            statements = [] if has_credits else [
                "ALTER TABLE users ADD COLUMN subreddit_checker_credits INT NOT NULL DEFAULT 0"
            ]
            statements.append(CREATE_ATTEMPTS)

            print(f"Mode: {'APPLY' if args.apply else 'READ-ONLY PLAN'}")
            for number, statement in enumerate(statements, 1):
                print(f"{number:02d}. {statement};")
            if not args.apply:
                print("No DDL executed. Back up production, review the plan, then rerun with --apply.")
                return
            for statement in statements:
                cursor.execute(statement)
            cursor.execute(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='users' AND COLUMN_NAME='subreddit_checker_credits'",
                (connection_config()['database'],),
            )
            if cursor.fetchone() is None:
                raise RuntimeError('Credit column verification failed')
            cursor.execute(
                "SELECT TABLE_NAME FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='subreddit_submission_attempts'",
                (connection_config()['database'],),
            )
            if cursor.fetchone() is None:
                raise RuntimeError('Submission table verification failed')
            print('Verified additive submission attribution and checker credit schema.')
    finally:
        connection.close()


if __name__ == '__main__':
    main()
