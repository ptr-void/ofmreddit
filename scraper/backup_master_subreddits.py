#!/usr/bin/env python3
"""Create a read-only JSON snapshot of master_subreddits with a SHA-256 file."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

try:
    from scraper.migrate_schema import connection_config
except ModuleNotFoundError:  # direct: python scraper/backup_master_subreddits.py
    from migrate_schema import connection_config


load_dotenv()
load_dotenv(Path(__file__).resolve().parents[1] / ".env.local", override=False)


def serialize(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return {"base64": base64.b64encode(value).decode("ascii")}
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    import mysql.connector

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output or Path("output") / f"master_subreddits_{timestamp}.json"
    output.parent.mkdir(parents=True, exist_ok=True)

    connection = mysql.connector.connect(**connection_config())
    cursor = connection.cursor()
    try:
        cursor.execute("SHOW CREATE TABLE master_subreddits")
        create_row = cursor.fetchone()
        if not create_row:
            raise SystemExit("master_subreddits was not found")
        create_sql = create_row[1]

        cursor.execute("SELECT * FROM master_subreddits ORDER BY id")
        columns = [item[0] for item in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        cursor.close()
        connection.close()

    payload = {
        "format": "ofmreddit.master_subreddits.backup.v1",
        "created_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "database": os.environ["DB_NAME"],
        "table": "master_subreddits",
        "create_table_sql": create_sql,
        "columns": columns,
        "row_count": len(rows),
        "rows": rows,
    }
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, default=serialize).encode("utf-8")
    output.write_bytes(encoded)
    digest = hashlib.sha256(encoded).hexdigest()
    checksum = output.with_suffix(output.suffix + ".sha256")
    checksum.write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(f"Backup: {output.resolve()}")
    print(f"SHA-256: {checksum.resolve()}")
    print(f"Rows: {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
