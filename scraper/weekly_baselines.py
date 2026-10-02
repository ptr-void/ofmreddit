#!/usr/bin/env python3
"""Backfill dated historical seven-day baselines, never current weekly cells.

Reads only Reddit post IDs, timestamps and current scores. A bounded listing must
cover the whole selected period; incomplete windows are not published. Default is
read-only. --apply backs up the separate baseline worksheet and verifies writes.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

try:
    from scraper.subreddit_sync import (
        GoogleSheetStore, RedditAnalyzer, atomic_write_json, average_int,
        iso_utc, normalize_subreddit, parse_utc, utc_now,
    )
except ModuleNotFoundError:
    from subreddit_sync import (
        GoogleSheetStore, RedditAnalyzer, atomic_write_json, average_int,
        iso_utc, normalize_subreddit, parse_utc, utc_now,
    )

TITLE = "Weekly Metric Baselines"
HEADERS = ["Subreddit", "Metric", "Window Start UTC", "Window End UTC",
           "Observed At UTC", "Score", "Post Count", "Post IDs JSON"]
METRICS = {"Hot 1 (Weekly)": (0, 1), "Hot 2-5 Avg (Weekly)": (1, 5),
           "Hot 6-10 Avg (Weekly)": (5, 10)}


def historical_baselines(name: str, posts: list[dict[str, Any]], requested: list[str],
                         *, now: datetime, listing_complete: bool) -> list[list[Any]]:
    """Most recent complete historical seven-day period supporting each rank group.

    Scores are measured NOW for older posts, not claimed as archived scores from
    that date. Different groups may need different dated periods when activity is
    sparse. A window older than the current week never replaces current readings.
    """
    unique = {}
    unusable = []
    for post in posts:
        identity, created, score = post.get("id"), post.get("created_utc"), post.get("score")
        if isinstance(created, bool) or not isinstance(created, (int, float)):
            return [] # Its period is unknown, so completeness cannot be established.
        try:
            stamp = datetime.fromtimestamp(created, now.tzinfo)
        except (ValueError, OverflowError, OSError):
            return []
        if not identity or isinstance(score, bool) or not isinstance(score, int):
            unusable.append(stamp)
            continue
        if stamp <= now:
            unique[str(identity)] = {"id": str(identity), "stamp": stamp, "score": score}
    ordered = sorted(unique.values(), key=lambda post: post["stamp"], reverse=True)
    if not ordered:
        return []
    earliest = ordered[-1]["stamp"]
    pending = {metric for metric in requested if metric in METRICS}
    output = []
    for end in dict.fromkeys(post["stamp"] for post in ordered if post["stamp"] < now - timedelta(days=7)):
        start = end - timedelta(days=7)
        # Reaching a listing cap while still inside a window leaves its top ranks unknown.
        if not listing_complete and earliest >= start:
            continue
        if any(start < stamp <= end for stamp in unusable):
            continue # An unknown score could change the ranking and every group mean.
        window = sorted((post for post in ordered if start < post["stamp"] <= end),
                        key=lambda post: (-post["score"], post["id"]))
        for metric in METRICS:
            if metric not in pending:
                continue
            first, last = METRICS[metric]
            group = window[first:last]
            if not group:
                continue
            score = average_int([post["score"] for post in group])
            if score <= 0:
                continue
            output.append([name, metric, iso_utc(start), iso_utc(end), iso_utc(now), score,
                           len(window), json.dumps([post["id"] for post in window[:10]], separators=(",", ":"))])
            pending.remove(metric)
        if not pending:
            break
    return output


def missing_metrics(matrix, names=None):
    lookup = {header.strip().lower(): index for index, header in enumerate(matrix[0])}
    ni, si = lookup["subreddit"], lookup.get("sync status", -1)
    allowed = None if names is None else {normalize_subreddit(name) for name in names}
    missing = {}
    for row in matrix[1:]:
        name = normalize_subreddit(row[ni] if len(row) > ni else "")
        if not name or (allowed is not None and name not in allowed):
            continue
        if si >= 0 and len(row) > si and str(row[si]).strip().lower() == "archived":
            continue
        for metric in METRICS:
            column = lookup.get(metric.lower(), -1)
            value = str(row[column]).strip() if 0 <= column < len(row) else ""
            if column >= 0 and value in ("", "0"):
                missing.setdefault(name, set()).add(metric)
    return missing


def stored_keys(values, now):
    if values and values[0] != HEADERS:
        raise RuntimeError("Weekly Metric Baselines headers changed; no baselines written")
    result = set()
    for row in values[1:]:
        if len(row) != len(HEADERS) or row[1] not in METRICS:
            continue
        start, end, observed = (parse_utc(str(row[index])) for index in (2, 3, 4))
        try:
            score, count = int(row[5]), int(row[6])
            ids = json.loads(row[7])
        except (ValueError, TypeError):
            continue
        first, _ = METRICS[row[1]]
        if (start and end and observed and end - start == timedelta(days=7)
            and end < now - timedelta(days=7) and end <= observed <= now
            and score > 0 and count > first and isinstance(ids, list) and all(isinstance(identity, str) and identity for identity in ids)
            and len(set(ids)) == len(ids) and len(ids) == min(count, 10)):
            result.add((normalize_subreddit(row[0]), row[1]))
    return result


def _worksheet(store):
    try:
        return store.workbook.worksheet(TITLE)
    except Exception as exc:
        if type(exc).__name__ != "WorksheetNotFound":
            raise
        return None


def backfill(store, analyzer, *, names=None, apply=False, max_posts=1000, max_subreddits=30):
    now = utc_now()
    stamp = now.strftime("%Y%m%dT%H%M%S%fZ")
    path = Path("output") / f"weekly-baseline-backfill-{stamp}.json"
    _, matrix = store._load_sheet1()
    sheet = _worksheet(store)
    before = sheet.get_all_values() if sheet else []
    existing = stored_keys(before, now)
    missing = missing_metrics(matrix, names)
    targets = {name: sorted(metric for metric in metrics if (name, metric) not in existing)
               for name, metrics in missing.items()}
    targets = {name: metrics for name, metrics in targets.items() if metrics}
    report = {"checked_at": iso_utc(now), "apply": apply, "planned": [], "unresolved": [],
              "errors": [], "verified": False, "sheet": TITLE, "spreadsheet_id": store.workbook.id}
    max_posts = max(10, min(1000, max_posts))
    for name, metrics in list(targets.items())[:max(0, max_subreddits)]:
        try:
            subreddit = analyzer.reddit.subreddit(name)
            analyzer._call(subreddit._fetch, f"r/{name} baseline identity")
            if normalize_subreddit(subreddit.display_name) != name:
                raise RuntimeError("Reddit returned a different subreddit")
            listing = analyzer._call(lambda: list(subreddit.new(limit=max_posts)), f"r/{name} baseline posts")
            posts = [{"id": post.id, "created_utc": post.created_utc, "score": post.score} for post in listing
                     if not getattr(post, "removed_by_category", None) and not getattr(post, "banned_by", None)]
            rows = historical_baselines(name, posts, metrics, now=now, listing_complete=len(listing) < max_posts)
            report["planned"].extend(rows)
            recovered = {row[1] for row in rows}
            report["unresolved"].extend({"subreddit": name, "metric": metric, "reason": "No complete positive historical window in the bounded listing"}
                                         for metric in metrics if metric not in recovered)
            atomic_write_json(path, report)
            print(f"r/{name}: {len(rows)} historical baseline(s), {len(listing)} posts inspected", flush=True)
        except Exception as exc:
            report["errors"].append({"subreddit": name, "error": str(exc)[:500]})
    atomic_write_json(path, report)
    if apply:
        apply_report(store, report, path)
    print(f"Report: {path.resolve()}", flush=True)
    return report


def apply_report(store, report, path):
    """Apply an already-collected plan without fetching Reddit again."""
    if report.get('sheet') != TITLE or report.get('spreadsheet_id') != store.workbook.id:
        raise RuntimeError('Baseline plan belongs to a different spreadsheet')
    planned = report.get('planned')
    if not isinstance(planned, list) or any(not isinstance(row, list) or len(row) != len(HEADERS) for row in planned):
        raise RuntimeError('Invalid baseline plan')
    if len(stored_keys([HEADERS, *planned], utc_now())) != len(planned):
        raise RuntimeError('Baseline plan contains invalid or duplicate observations')
    report['apply'] = True
    if report["planned"]:
        # Recheck source membership, missing cells and existing baselines immediately before writing.
        store._sheet1_values = None
        _, fresh = store._load_sheet1()
        holes = missing_metrics(fresh)
        sheet = _worksheet(store)
        before = sheet.get_all_values() if sheet else []
        existing = stored_keys(before, utc_now())
        rows = [row for row in report["planned"] if row[1] in holes.get(row[0], set())
                and (row[0], row[1]) not in existing]
        backup = Path("output") / f"weekly-baseline-backup-{utc_now().strftime('%Y%m%dT%H%M%S%fZ')}.json"
        atomic_write_json(backup, {"spreadsheet_id": store.workbook.id, "sheet": TITLE, "existed": sheet is not None,
                                  "values": before, "appended": rows})
        report["backup"] = str(backup.resolve())
        report["applied"] = rows
        atomic_write_json(path, report)
        if rows:
            if sheet is None:
                sheet = store.workbook.add_worksheet(title=TITLE, rows=1000, cols=len(HEADERS))
                sheet.update(values=[HEADERS], range_name="A1:H1")
            sheet.append_rows(rows, value_input_option="RAW")
            checked = {tuple(str(value) for value in row) for row in sheet.get_all_values()[1:]}
            if any(tuple(str(value) for value in row) not in checked for row in rows):
                raise RuntimeError("Baseline readback mismatch; inspect report and backup")
    report["verified"] = True
    atomic_write_json(path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--apply-report", type=Path, help="Apply a saved dry-run plan without repeating Reddit reads")
    parser.add_argument("--max-posts", type=int, default=1000)
    parser.add_argument("--max-subreddits", type=int, default=30)
    args = parser.parse_args()
    store = GoogleSheetStore(os.environ["SPREADSHEET_ID"])
    if args.apply_report:
        if not args.apply:
            parser.error("--apply-report requires --apply")
        report = json.loads(args.apply_report.read_text(encoding="utf-8"))
        apply_report(store, report, args.apply_report)
        print(f"Applied {len(report.get('applied', []))} historical baselines; verified={report['verified']}")
        return 0
    analyzer = RedditAnalyzer(new_limit=10, retry_attempts=2, retry_base_delay=1)
    report = backfill(store, analyzer, apply=args.apply, max_posts=args.max_posts, max_subreddits=args.max_subreddits)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
