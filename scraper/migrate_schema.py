#!/usr/bin/env python3
"""Plan or explicitly apply the scraper-v2 MySQL schema additions.

The default command is read-only. Pass ``--apply`` only after a backup and
review of the printed plan. Existing columns and indexes are never recreated.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


load_dotenv()
load_dotenv(Path(__file__).resolve().parents[1] / ".env.local", override=False)

COLUMNS = {
    "hot_1_weekly": "INT DEFAULT 0",
    "hot_2_5_weekly_avg": "INT DEFAULT 0",
    "hot_6_10_weekly_avg": "INT DEFAULT 0",
    "has_bot_bouncer": "BOOLEAN NULL",
    "requires_verification": "BOOLEAN NULL",
    "allows_cta_captions": "BOOLEAN NULL",
    "observed_accounts": "INT DEFAULT 0",
    "cta_match_count": "INT DEFAULT 0",
    "cta_sample_size": "INT DEFAULT 0",
    "weekly_top_10_json": "LONGTEXT NULL",
    "last_scraped_at": "DATETIME NULL",
    "last_scrape_status": "VARCHAR(32) NULL",
    "last_scrape_error": "VARCHAR(500) NULL",
}
INDEX_NAME = "idx_master_subreddits_last_scraped_at"


def connection_config() -> dict[str, Any]:
    required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise SystemExit(f"Missing database environment variables: {', '.join(missing)}")
    config: dict[str, Any] = {
        "host": os.environ["DB_HOST"],
        "port": int(os.getenv("DB_PORT") or "3306"),
        "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
        "database": os.environ["DB_NAME"],
        "connection_timeout": 20,
        "autocommit": True,
    }
    if os.getenv("DB_SSL_CA"):
        config["ssl_ca"] = os.environ["DB_SSL_CA"]
        config["ssl_verify_cert"] = os.getenv("DB_SSL_VERIFY_CERT", "true").lower() == "true"
    return config


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Execute only the missing additions")
    args = parser.parse_args()

    import mysql.connector

    connection = mysql.connector.connect(**connection_config())
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='master_subreddits'",
            (os.environ["DB_NAME"],),
        )
        existing_columns = {row[0] for row in cursor.fetchall()}
        if not existing_columns:
            raise SystemExit("master_subreddits was not found; run scripts/migrate_master.sql for a new database")

        cursor.execute(
            "SELECT INDEX_NAME FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='master_subreddits'",
            (os.environ["DB_NAME"],),
        )
        existing_indexes = {row[0] for row in cursor.fetchall()}

        statements = [
            f"ALTER TABLE master_subreddits ADD COLUMN `{name}` {definition}"
            for name, definition in COLUMNS.items()
            if name not in existing_columns
        ]
        if "last_scraped_at" in existing_columns.union(COLUMNS) and INDEX_NAME not in existing_indexes:
            statements.append(f"CREATE INDEX `{INDEX_NAME}` ON master_subreddits (`last_scraped_at`)")

        print(f"Mode: {'APPLY' if args.apply else 'READ-ONLY PLAN'}")
        print(f"Existing scraper-v2 columns: {len(existing_columns.intersection(COLUMNS))}/{len(COLUMNS)}")
        if not statements:
            print("Schema is current; no statements are needed.")
            return 0
        for number, statement in enumerate(statements, start=1):
            print(f"{number:02d}. {statement};")

        if not args.apply:
            print("No DDL executed. Back up production, review the plan, then rerun with --apply.")
            return 0

        for statement in statements:
            cursor.execute(statement)
        print(f"Applied and verified {len(statements)} schema additions.")
        return 0
    finally:
        cursor.close()
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
