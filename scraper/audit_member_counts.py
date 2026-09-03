#!/usr/bin/env python3
"""Audit explicitly selected member counts; apply only after saving a backup.

Only the Total Members cell is repaired. No rows, other metrics, or pass
checkpoints are changed. Missing/failed API results never become zero.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

try:
    from scraper.subreddit_sync import (
        GoogleSheetStore, RedditAnalyzer, atomic_write_json, column_letters,
        normalize_subreddit, parse_subscriber_count, utc_now,
    )
except ModuleNotFoundError:
    from subreddit_sync import (
        GoogleSheetStore, RedditAnalyzer, atomic_write_json, column_letters,
        normalize_subreddit, parse_subscriber_count, utc_now,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subreddit", action="append", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    store = GoogleSheetStore(os.environ["SPREADSHEET_ID"])
    headers, matrix = store._load_sheet1()
    lookup = {h.strip().lower(): i for i, h in enumerate(headers)}
    name_index, count_index = lookup["subreddit"], lookup["total members"]
    by_name = {
        normalize_subreddit(row[name_index]): row
        for row in matrix[1:] if len(row) > name_index and row[name_index].strip()
    }
    analyzer = RedditAnalyzer(new_limit=25, retry_attempts=4, retry_base_delay=3)
    results = []
    for name in dict.fromkeys(normalize_subreddit(n) for n in args.subreddit):
        row = by_name.get(name)
        if row is None:
            raise RuntimeError(f"r/{name} is not in the existing table")
        item = {"subreddit": name, "before": row[count_index] if len(row) > count_index else ""}
        try:
            sub = analyzer.reddit.subreddit(name)
            analyzer._call(sub._fetch, f"r/{name} member audit")
            if normalize_subreddit(str(getattr(sub, "display_name", ""))) != name:
                raise RuntimeError("Reddit identity mismatch")
            count = parse_subscriber_count(getattr(sub, "subscribers", None))
            if count is None:
                raise RuntimeError("Reddit did not return a valid subscriber count")
            item["after"] = count
        except Exception as exc:
            item["error"] = str(exc)
        results.append(item)

    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    report_path = Path("output") / f"member-count-audit-{stamp}.json"
    report = {"checked_at": utc_now().isoformat(), "apply": args.apply, "results": results}
    atomic_write_json(report_path, report)
    if args.apply:
        # Durable pre-write snapshot. It also preserves every unrelated value.
        backup_path = Path("output") / f"member-count-backup-{stamp}.json"
        atomic_write_json(backup_path, {"spreadsheet_id": os.environ["SPREADSHEET_ID"], "values": matrix})
        report["backup_path"] = str(backup_path.resolve())
        store._sheet1_values = None
        fresh_headers, fresh = store._load_sheet1()
        fresh_lookup = {h.strip().lower(): i for i, h in enumerate(fresh_headers)}
        ni, ci = fresh_lookup["subreddit"], fresh_lookup["total members"]
        updates = []
        for item in results:
            if "error" in item:
                continue
            matches = [(i, row) for i, row in enumerate(fresh[1:], 2)
                       if len(row) > ni and normalize_subreddit(row[ni]) == item["subreddit"]]
            if len(matches) != 1:
                raise RuntimeError("Source rows changed or contain duplicates; repeat the audit")
            i, row = matches[0]
            if (row[ci] if len(row) > ci else "") != item["before"]:
                raise RuntimeError("A member count changed during the audit; repeat before applying")
            updates.append({"range": f"{column_letters(ci + 1)}{i}", "values": [[item["after"]]]})
        if updates:
            store.sheet1.batch_update(updates, value_input_option="RAW")
            store.format_numeric_columns(fresh_headers)
            store._sheet1_values = None
            verified_headers, verified = store._load_sheet1()
            vi = {h.strip().lower(): i for i, h in enumerate(verified_headers)}
            readback = {normalize_subreddit(row[vi["subreddit"]]): row for row in verified[1:]
                        if len(row) > vi["subreddit"]}
            for item in results:
                if "after" not in item:
                    continue
                value = readback[item["subreddit"]][vi["total members"]]
                item["verified"] = int(value.replace(",", "")) == item["after"]
                if not item["verified"]:
                    raise RuntimeError("Member count readback mismatch; inspect backup and report")
        atomic_write_json(report_path, report)
    for item in results:
        print(item)
    print(f"Report: {report_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
