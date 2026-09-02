#!/usr/bin/env python3
"""Merge legacy Sheet2/Sheet3 data into Sheet1 and optionally delete extra tabs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import gspread
from google.oauth2.service_account import Credentials

from subreddit_sync import SHEET1_REQUIRED_HEADERS, _service_account_info, normalize_subreddit


ANALYTICS_ALIASES = {
    "Min Post Karma": "Minimum Post Karma",
    "Min Comment Karma": "Minimum Comment Karma",
    "Min Total Karma": "Minimum Combined Karma",
    "Min Account Age": "Minimum Account Age (days)",
    "Bot Bouncer": "Bot Bouncer Present",
    "Hot 1 (Weekly)": "Weekly Top 1 Upvotes",
    "Hot 2-5 Avg (Weekly)": "Weekly Top 2-5 Avg Upvotes",
    "Hot 6-10 Avg (Weekly)": "Weekly Top 6-10 Avg Upvotes",
    "CTA Captions": "CTA Captions",
    "Scraped At UTC": "Scraped At UTC",
    "Sync Status": "Sync Status",
    "Sync Error": "Sync Error",
}


def lookup(headers: list[str]) -> dict[str, int]:
    return {header.strip().lower(): index for index, header in enumerate(headers)}


def cell(row: list[str], columns: dict[str, int], name: str) -> str:
    index = columns.get(name.strip().lower())
    return row[index].strip() if index is not None and index < len(row) else ""


def merge_labels(*groups: list[str]) -> str:
    seen: set[str] = set()
    merged: list[str] = []
    for group in groups:
        for raw in group:
            for value in raw.replace("\n", ",").replace(";", ",").split(","):
                clean = value.strip().lower()
                if clean and clean not in seen:
                    seen.add(clean)
                    merged.append(clean)
    return ", ".join(merged)


def service_account_credentials() -> Credentials:
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    info = _service_account_info()
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if info:
        return Credentials.from_service_account_info(info, scopes=scopes)
    if path:
        return Credentials.from_service_account_file(path, scopes=scopes)
    raise RuntimeError("Google service-account credentials are not configured")


def backup_workbook(workbook: Any, output_dir: Path) -> tuple[Path, str]:
    payload = {
        "spreadsheet_id": workbook.id,
        "created_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "worksheets": [
            {
                "title": worksheet.title,
                "id": worksheet.id,
                "rows": worksheet.get_all_values(),
            }
            for worksheet in workbook.worksheets()
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = output_dir / f"google-sheet-backup-before-single-table-{stamp}.json"
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    path.write_bytes(data)
    return path.resolve(), hashlib.sha256(data).hexdigest()


def build_single_table(workbook: Any) -> list[list[str]]:
    sheet1_values = workbook.worksheet("Sheet1").get_all_values()
    sheet2_values = workbook.worksheet("Sheet2").get_all_values()
    sheet3_values = workbook.worksheet("Sheet3").get_all_values()
    if not sheet1_values or not sheet2_values or not sheet3_values:
        raise RuntimeError("Sheet1, Sheet2, and Sheet3 must contain headers before migration")

    sheet1_columns = lookup(sheet1_values[0])
    sheet2_columns = lookup(sheet2_values[0])
    sheet3_columns = lookup(sheet3_values[0])
    sheet1_subreddit = sheet1_columns.get("subreddit")
    sheet2_subreddit = sheet2_columns.get("subreddit name", sheet2_columns.get("subreddit"))
    sheet3_subreddit = sheet3_columns.get("subreddit")
    if None in {sheet1_subreddit, sheet2_subreddit, sheet3_subreddit}:
        raise RuntimeError("Every source table must contain a subreddit identifier column")

    niches: dict[str, list[str]] = {}
    for row in sheet2_values[1:]:
        key = normalize_subreddit(row[sheet2_subreddit] if sheet2_subreddit < len(row) else "")
        if not key:
            continue
        tags = [value for index, value in enumerate(row) if index != sheet2_subreddit and value.strip()]
        niches.setdefault(key, []).extend(tags)

    analytics: dict[str, tuple[str, list[str]]] = {}
    for row in sheet3_values[1:]:
        key = normalize_subreddit(row[sheet3_subreddit] if sheet3_subreddit < len(row) else "")
        if not key:
            continue
        scraped_at = cell(row, sheet3_columns, "Scraped At UTC")
        previous = analytics.get(key)
        if previous is None or scraped_at >= previous[0]:
            analytics[key] = (scraped_at, row)

    matrix: list[list[str]] = [list(SHEET1_REQUIRED_HEADERS)]
    for source_row in sheet1_values[1:]:
        subreddit = cell(source_row, sheet1_columns, "Subreddit")
        key = normalize_subreddit(subreddit)
        if not key:
            continue
        advanced_row = analytics.get(key, ("", []))[1]
        row: list[str] = []
        for header in SHEET1_REQUIRED_HEADERS:
            if header == "Niche":
                row.append(merge_labels([cell(source_row, sheet1_columns, "Niche")], niches.get(key, [])))
            elif header in ANALYTICS_ALIASES:
                row.append(cell(advanced_row, sheet3_columns, ANALYTICS_ALIASES[header]))
            else:
                row.append(cell(source_row, sheet1_columns, header))
        matrix.append(row)
    return matrix


def apply_single_table(workbook: Any, matrix: list[list[str]], delete_extra_sheets: bool) -> None:
    sheet1 = workbook.worksheet("Sheet1")
    if sheet1.col_count < len(SHEET1_REQUIRED_HEADERS):
        sheet1.add_cols(len(SHEET1_REQUIRED_HEADERS) - sheet1.col_count)
    end_column = gspread.utils.rowcol_to_a1(1, len(SHEET1_REQUIRED_HEADERS))[:-1]
    sheet1.update(matrix, range_name=f"A1:{end_column}{len(matrix)}", value_input_option="RAW")

    read_back = sheet1.get(f"A1:{end_column}{len(matrix)}")
    if read_back != matrix:
        raise RuntimeError("Sheet1 read-back did not match the migration matrix; extra tabs were preserved")

    sheet1.freeze(rows=1)
    sheet1.format(
        f"A1:{end_column}1",
        {"textFormat": {"bold": True}, "horizontalAlignment": "CENTER"},
    )
    sheet1.hide_columns(14, 17)
    try:
        sheet1.set_basic_filter(f"A1:N{len(matrix)}")
    except gspread.exceptions.APIError:
        pass

    if delete_extra_sheets:
        for worksheet in list(workbook.worksheets()):
            if worksheet.id != sheet1.id:
                workbook.del_worksheet(worksheet)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spreadsheet-id", default=os.getenv("SPREADSHEET_ID", ""))
    parser.add_argument("--backup-dir", type=Path, default=Path("outputs"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--delete-extra-sheets", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.spreadsheet_id:
        raise RuntimeError("SPREADSHEET_ID is required")
    workbook = gspread.authorize(service_account_credentials()).open_by_key(args.spreadsheet_id)
    matrix = build_single_table(workbook)
    print(json.dumps({"mode": "apply" if args.apply else "preview", "rows": len(matrix) - 1, "columns": matrix[0]}))
    if not args.apply:
        return 0
    backup_path, backup_sha256 = backup_workbook(workbook, args.backup_dir)
    apply_single_table(workbook, matrix, args.delete_extra_sheets)
    print(json.dumps({"backup": str(backup_path), "sha256": backup_sha256, "tabs": [w.title for w in workbook.worksheets()]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
