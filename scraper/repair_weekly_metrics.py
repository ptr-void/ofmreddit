#!/usr/bin/env python3
"""Restore only blank/zero weekly cells backed by saved positive observations.

Read-only by default; --apply saves a backup, revalidates names and values,
updates only planned metric cells, and verifies readback. No fresh scrape,
checkpoint changes, fabricated scores, or unrelated Sheet edits.
"""
from __future__ import annotations
import argparse
import os
import re
from pathlib import Path
try:
    from scraper.subreddit_sync import (GoogleSheetStore, WEEKLY_HISTORY_HEADERS, atomic_write_json,
        column_letters, normalize_subreddit, parse_utc, rolling_weekly_metrics, utc_now)
except ModuleNotFoundError:
    from subreddit_sync import (GoogleSheetStore, WEEKLY_HISTORY_HEADERS, atomic_write_json,
        column_letters, normalize_subreddit, parse_utc, rolling_weekly_metrics, utc_now)

HEADERS = ("Hot 1 (Weekly)", "Hot 2-5 Avg (Weekly)", "Hot 6-10 Avg (Weekly)")


def repair_plan(matrix, history, now=None):
    if not matrix or not history or history[0] != WEEKLY_HISTORY_HEADERS:
        raise ValueError("Expected source and Weekly Metrics History headers")
    lookup = {header.strip().lower(): index for index, header in enumerate(matrix[0])}
    ni = lookup["subreddit"]
    si = lookup.get("sync status", -1)
    columns = [lookup[header.lower()] for header in HEADERS]
    samples = {}
    now = now or utc_now()
    for row in history[1:]:
        if len(row) < 3:
            continue
        stamp = parse_utc(str(row[1]))
        if not stamp or stamp > now:
            continue
        row = list(row) + [""] * max(0, 5 - len(row))
        values = tuple(int(value) if re.fullmatch(r"\d+", str(value).strip()) else None for value in row[2:5])
        samples.setdefault(normalize_subreddit(row[0]), {})[stamp] = values
    plan = []
    for number, row in enumerate(matrix[1:], 2):
        name = normalize_subreddit(row[ni] if len(row) > ni else "")
        if not name or (si >= 0 and len(row) > si and row[si].strip().lower() == "archived"):
            continue
        recorded = samples.get(name, {})
        means = rolling_weekly_metrics(list(recorded.items()), now=now)
        for column, header, mean in zip(columns, HEADERS, means):
            before = str(row[column]) if len(row) > column else ""
            if mean is not None and before.strip() in ("", "0"):
                plan.append({"subreddit": name, "header": header, "before": before, "after": mean,
                             "range": f"{column_letters(column + 1)}{number}"})
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    store = GoogleSheetStore(os.environ["SPREADSHEET_ID"])
    _, matrix = store._load_sheet1()
    history = store.workbook.worksheet("Weekly Metrics History").get_all_values()
    plan = repair_plan(matrix, history)
    stamp = utc_now().strftime("%Y%m%dT%H%M%S%fZ")
    path = Path("output") / f"weekly-metric-repair-{stamp}.json"
    report = {"spreadsheet_id": os.environ["SPREADSHEET_ID"], "sheet": store.sheet1.title,
              "apply": args.apply, "plan": plan, "verified": False}
    atomic_write_json(path, report)
    if args.apply and plan:
        backup = Path("output") / f"weekly-metric-backup-{stamp}.json"
        atomic_write_json(backup, {"spreadsheet_id": os.environ["SPREADSHEET_ID"], "sheet": store.sheet1.title, "values": matrix})
        report["backup"] = str(backup.resolve())
        store._sheet1_values = None
        _, fresh = store._load_sheet1()
        current = repair_plan(fresh, history)
        identity = lambda items: sorted((p["subreddit"], p["header"], p["before"], p["after"]) for p in items)
        if identity(current) != identity(plan):
            raise RuntimeError("Metric cells changed during audit; repeat before applying")
        report["plan"] = current
        atomic_write_json(path, report)
        store.sheet1.batch_update([{"range": item["range"], "values": [[item["after"]]]} for item in current], value_input_option="RAW")
        store._sheet1_values = None
        _, checked = store._load_sheet1()
        lookup = {header.lower(): index for index, header in enumerate(checked[0])}
        ni = lookup["subreddit"]
        for item in current:
            row_number = int(re.search(r"[0-9]+$", item["range"]).group())
            row = checked[row_number - 1]
            column = lookup[item["header"].lower()]
            if normalize_subreddit(row[ni]) != item["subreddit"] or int(str(row[column]).replace(",", "")) != item["after"]:
                raise RuntimeError("Repair readback mismatch; inspect report and backup")
        report["verified"] = True
        atomic_write_json(path, report)
    print(f"{'Applied' if args.apply else 'Planned'} {len(plan)} history-backed weekly cell repairs; verified={report['verified']}")
    print(f"Report: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
