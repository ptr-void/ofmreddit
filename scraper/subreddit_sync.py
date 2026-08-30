#!/usr/bin/env python3
"""Resumable Reddit -> Google Sheets/MySQL subreddit analytics sync.

The script is read-only unless ``--write-sheets`` and/or ``--write-db`` is
passed.  Google Sheet rows are matched by normalized subreddit name rather
than row number, and MySQL defaults to updating existing rows only.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import statistics
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence, TypeVar


LOG = logging.getLogger("subreddit_sync")
UTC = timezone.utc
T = TypeVar("T")

LEGACY_SHEET3_HEADERS = [
    "Subreddit",
    "Barrier to Visibility (BTV)",
    "Top Slot Diversity Index (TSDI)",
    "Upvote to Root Comment Ratio",
    "Minimum Post Karma",
    "Minimum Comment Karma",
    "Minimum Account Age (days)",
]

EXTRA_SHEET3_HEADERS = [
    "Total Members",
    "Minimum Combined Karma",
    "Observed Accounts",
    "Bot Bouncer Present",
    "Requires Verification",
    "Weekly Top 1 Upvotes",
    "Weekly Top 2-5 Avg Upvotes",
    "Weekly Top 6-10 Avg Upvotes",
    "Weekly Top 10 Posts",
    "CTA Captions",
    "CTA Match Count",
    "CTA Sample Size",
    "Comment Ratio Basis",
    "Scraped At UTC",
    "Sync Status",
    "Sync Error",
]

SHEET3_HEADERS = LEGACY_SHEET3_HEADERS + EXTRA_SHEET3_HEADERS
CTA_PATTERN = re.compile(r"\?|\b(?:do|or|would|how|what)\b", re.IGNORECASE)
BOT_BOUNCER_NAMES = ("botbouncer", "safestbot")

try:
    from dotenv import load_dotenv

    load_dotenv()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env.local", override=False)
except ImportError:
    pass


def utc_now() -> datetime:
    return datetime.now(UTC)


def normalize_subreddit(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"^(?:https?://(?:www\.)?reddit\.com/)?r/", "", value, flags=re.I)
    return value.strip("/ ").lower()


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def average_int(values: Sequence[int]) -> int:
    return round(sum(values) / len(values)) if values else 0


def detect_cta_titles(
    posts: Iterable[Any],
    *,
    now_epoch: float | None = None,
    minimum_age_seconds: int = 3600,
) -> tuple[bool | None, int, int]:
    """Infer whether surviving, mature post titles use the requested CTA forms."""
    now_epoch = time.time() if now_epoch is None else now_epoch
    matured: list[Any] = []
    for post in posts:
        created = float(getattr(post, "created_utc", 0) or 0)
        if now_epoch - created < minimum_age_seconds:
            continue
        if getattr(post, "removed_by_category", None) or getattr(post, "banned_by", None):
            continue
        matured.append(post)

    matches = sum(bool(CTA_PATTERN.search(str(getattr(post, "title", "") or ""))) for post in matured)
    sample_size = len(matured)
    if sample_size == 0:
        return None, 0, 0
    threshold = 2 if sample_size >= 5 else 1
    return matches >= threshold, matches, sample_size


def compact_top_posts(posts: Sequence[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for rank, post in enumerate(posts[:10], start=1):
        permalink = str(getattr(post, "permalink", "") or "")
        if permalink.startswith("/"):
            permalink = f"https://www.reddit.com{permalink}"
        result.append(
            {
                "rank": rank,
                "id": str(getattr(post, "id", "") or ""),
                "title": str(getattr(post, "title", "") or "")[:300],
                "upvotes": int(getattr(post, "score", 0) or 0),
                "comments": int(getattr(post, "num_comments", 0) or 0),
                "url": permalink,
                "created_utc": int(getattr(post, "created_utc", 0) or 0),
            }
        )
    return result


def retry_call(
    fn: Callable[[], T],
    *,
    label: str,
    attempts: int,
    base_delay: float,
    retryable: Callable[[Exception], bool] | None = None,
) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # adapter boundary intentionally catches third-party errors
            last_error = exc
            if retryable and not retryable(exc):
                raise
            if attempt >= attempts:
                break
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, max(0.1, base_delay / 3))
            LOG.warning("%s failed (%s/%s): %s; retrying in %.1fs", label, attempt, attempts, exc, delay)
            time.sleep(delay)
    assert last_error is not None
    raise last_error


@dataclass(frozen=True)
class SourceRow:
    sheet_row: int
    subreddit: str

    @property
    def key(self) -> str:
        return normalize_subreddit(self.subreddit)


@dataclass
class ScrapeResult:
    subreddit: str
    source_row: int
    scraped_at_utc: str
    status: str = "success"
    error: str = ""
    subscribers: int | None = None
    btv: int | None = None
    tsdi: int | None = None
    upvote_comment_ratio: float | None = None
    comment_ratio_basis: str = "total comments"
    min_post_karma: int | None = None
    min_comment_karma: int | None = None
    min_combined_karma: int | None = None
    min_account_age_days: int | None = None
    observed_accounts: int = 0
    has_bot_bouncer: bool | None = None
    requires_verification: bool | None = None
    weekly_top_1_upvotes: int = 0
    weekly_top_2_5_avg_upvotes: int = 0
    weekly_top_6_10_avg_upvotes: int = 0
    weekly_top_10_posts: list[dict[str, Any]] = field(default_factory=list)
    allows_cta_captions: bool | None = None
    cta_match_count: int = 0
    cta_sample_size: int = 0

    @classmethod
    def failed(cls, source: SourceRow, exc: Exception) -> "ScrapeResult":
        message = re.sub(r"\s+", " ", str(exc)).strip()[:500]
        return cls(
            subreddit=source.subreddit,
            source_row=source.sheet_row,
            scraped_at_utc=utc_now().isoformat().replace("+00:00", "Z"),
            status="error",
            error=message or exc.__class__.__name__,
        )

    def sheet_values(self) -> dict[str, Any]:
        bool_label = lambda value: "Unknown" if value is None else ("Yes" if value else "No")
        return {
            "Subreddit": self.subreddit,
            "Barrier to Visibility (BTV)": self.btv,
            "Top Slot Diversity Index (TSDI)": self.tsdi,
            "Upvote to Root Comment Ratio": self.upvote_comment_ratio,
            "Minimum Post Karma": self.min_post_karma,
            "Minimum Comment Karma": self.min_comment_karma,
            "Minimum Account Age (days)": self.min_account_age_days,
            "Total Members": self.subscribers,
            "Minimum Combined Karma": self.min_combined_karma,
            "Observed Accounts": self.observed_accounts,
            "Bot Bouncer Present": bool_label(self.has_bot_bouncer),
            "Requires Verification": bool_label(self.requires_verification),
            "Weekly Top 1 Upvotes": self.weekly_top_1_upvotes,
            "Weekly Top 2-5 Avg Upvotes": self.weekly_top_2_5_avg_upvotes,
            "Weekly Top 6-10 Avg Upvotes": self.weekly_top_6_10_avg_upvotes,
            "Weekly Top 10 Posts": json.dumps(self.weekly_top_10_posts, ensure_ascii=False, separators=(",", ":")),
            "CTA Captions": bool_label(self.allows_cta_captions),
            "CTA Match Count": self.cta_match_count,
            "CTA Sample Size": self.cta_sample_size,
            "Comment Ratio Basis": self.comment_ratio_basis,
            "Scraped At UTC": self.scraped_at_utc,
            "Sync Status": self.status,
            "Sync Error": self.error,
        }


@dataclass
class SheetState:
    status: str = ""
    scraped_at: datetime | None = None


class RedditAnalyzer:
    def __init__(
        self,
        *,
        hot_limit: int,
        new_limit: int,
        exact_root_comments: bool,
        retry_attempts: int,
        retry_base_delay: float,
    ) -> None:
        try:
            import praw
        except ImportError as exc:
            raise RuntimeError("Install scraper/requirements.txt before running the sync") from exc

        client_id = os.getenv("REDDIT_CLIENT_ID")
        client_secret = os.getenv("REDDIT_CLIENT_SECRET")
        user_agent = os.getenv("REDDIT_USER_AGENT")
        missing = [name for name, value in {
            "REDDIT_CLIENT_ID": client_id,
            "REDDIT_CLIENT_SECRET": client_secret,
            "REDDIT_USER_AGENT": user_agent,
        }.items() if not value]
        if missing:
            raise RuntimeError(f"Missing Reddit environment variables: {', '.join(missing)}")

        reddit_options: dict[str, Any] = {
            "client_id": client_id,
            "client_secret": client_secret,
            "user_agent": user_agent,
            "check_for_async": False,
            "ratelimit_seconds": 300,
            "timeout": 30,
        }
        if os.getenv("REDDIT_REFRESH_TOKEN"):
            reddit_options["refresh_token"] = os.environ["REDDIT_REFRESH_TOKEN"]
        self.reddit = praw.Reddit(
            **reddit_options,
        )
        self.hot_limit = hot_limit
        self.new_limit = new_limit
        self.exact_root_comments = exact_root_comments
        self.retry_attempts = retry_attempts
        self.retry_base_delay = retry_base_delay

    @staticmethod
    def _retryable(exc: Exception) -> bool:
        text = f"{exc.__class__.__name__}: {exc}".lower()
        terminal_markers = ("forbidden", "notfound", "404", "403", "redirect")
        return not any(marker in text for marker in terminal_markers)

    def _call(self, fn: Callable[[], T], label: str) -> T:
        return retry_call(
            fn,
            label=label,
            attempts=self.retry_attempts,
            base_delay=self.retry_base_delay,
            retryable=self._retryable,
        )

    def analyze(self, source: SourceRow) -> ScrapeResult:
        subreddit = self.reddit.subreddit(source.key)
        self._call(subreddit._fetch, f"r/{source.key} about")
        now_epoch = time.time()

        subscribers = int(getattr(subreddit, "subscribers", 0) or 0)
        subreddit_type = str(getattr(subreddit, "subreddit_type", "") or "").lower()
        requires_verification = subreddit_type in {"restricted", "private"}

        try:
            moderators = self._call(lambda: list(subreddit.moderator()), f"r/{source.key} moderators")
            moderator_names = [re.sub(r"[^a-z0-9]+", "", str(mod).lower()) for mod in moderators]
            has_bot_bouncer: bool | None = any(
                marker in name for name in moderator_names for marker in BOT_BOUNCER_NAMES
            )
        except Exception as exc:
            LOG.warning("r/%s moderator list unavailable: %s", source.key, exc)
            has_bot_bouncer = None

        weekly_posts = self._call(
            lambda: list(subreddit.top(time_filter="week", limit=10)),
            f"r/{source.key} weekly top",
        )
        weekly_scores = [int(getattr(post, "score", 0) or 0) for post in weekly_posts]

        hot_posts = self._call(lambda: list(subreddit.hot(limit=self.hot_limit)), f"r/{source.key} hot")
        hot_scores = [int(getattr(post, "score", 0) or 0) for post in hot_posts]
        btv = int(statistics.median(hot_scores)) if hot_scores else 0
        tsdi = len({str(post.author).lower() for post in hot_posts if getattr(post, "author", None)})

        if self.exact_root_comments:
            root_comments = 0
            for post in hot_posts:
                self._call(lambda post=post: post.comments.replace_more(limit=0), f"post {post.id} comments")
                root_comments += len(post.comments)
            comment_count = root_comments
            ratio_basis = "root comments"
        else:
            comment_count = sum(int(getattr(post, "num_comments", 0) or 0) for post in hot_posts)
            ratio_basis = "total comments"
        score_total = sum(hot_scores)
        ratio = round(score_total / comment_count, 2) if comment_count else float(score_total)

        new_posts = self._call(lambda: list(subreddit.new(limit=self.new_limit)), f"r/{source.key} new")
        cta_allowed, cta_matches, cta_sample = detect_cta_titles(new_posts, now_epoch=now_epoch)

        post_karma: list[int] = []
        comment_karma: list[int] = []
        combined_karma: list[int] = []
        account_age_days: list[int] = []
        seen_authors: set[str] = set()

        for post in new_posts:
            author = getattr(post, "author", None)
            author_name = str(author or "").strip()
            author_key = author_name.lower()
            if not author_name or author_key in seen_authors or author_key in {"[deleted]", "automoderator"}:
                continue
            if getattr(post, "removed_by_category", None) or getattr(post, "banned_by", None):
                continue
            seen_authors.add(author_key)
            try:
                self._call(author._fetch, f"u/{author_name} profile")
                pk = int(getattr(author, "link_karma", 0) or 0)
                ck = int(getattr(author, "comment_karma", 0) or 0)
                total = int(getattr(author, "total_karma", pk + ck) or (pk + ck))
                created = float(getattr(author, "created_utc", now_epoch) or now_epoch)
                age = max(0, int((now_epoch - created) / 86400))
                if total < 5 and age < 2:
                    continue
                post_karma.append(pk)
                comment_karma.append(ck)
                combined_karma.append(total)
                account_age_days.append(age)
            except Exception as exc:
                LOG.debug("Skipping u/%s profile: %s", author_name, exc)

        scraped_at = utc_now().isoformat().replace("+00:00", "Z")
        return ScrapeResult(
            subreddit=source.subreddit,
            source_row=source.sheet_row,
            scraped_at_utc=scraped_at,
            subscribers=subscribers,
            btv=btv,
            tsdi=tsdi,
            upvote_comment_ratio=ratio,
            comment_ratio_basis=ratio_basis,
            min_post_karma=min(post_karma) if post_karma else None,
            min_comment_karma=min(comment_karma) if comment_karma else None,
            min_combined_karma=min(combined_karma) if combined_karma else None,
            min_account_age_days=min(account_age_days) if account_age_days else None,
            observed_accounts=len(post_karma),
            has_bot_bouncer=has_bot_bouncer,
            requires_verification=requires_verification,
            weekly_top_1_upvotes=weekly_scores[0] if weekly_scores else 0,
            weekly_top_2_5_avg_upvotes=average_int(weekly_scores[1:5]),
            weekly_top_6_10_avg_upvotes=average_int(weekly_scores[5:10]),
            weekly_top_10_posts=compact_top_posts(weekly_posts),
            allows_cta_captions=cta_allowed,
            cta_match_count=cta_matches,
            cta_sample_size=cta_sample,
        )


def _service_account_info() -> dict[str, Any] | None:
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        path = Path(raw)
        if not raw.startswith("{") and path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
        return json.loads(raw)

    project_id = os.getenv("GOOGLE_PROJECT_ID")
    client_email = os.getenv("GOOGLE_CLIENT_EMAIL")
    private_key = os.getenv("GOOGLE_PRIVATE_KEY")
    if project_id and client_email and private_key:
        return {
            "type": "service_account",
            "project_id": project_id,
            "private_key": private_key.replace("\\n", "\n"),
            "client_email": client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    return None


def column_letters(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


class GoogleSheetStore:
    SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

    def __init__(self, spreadsheet_id: str, *, allow_create: bool = False) -> None:
        try:
            import gspread
            from google.oauth2.service_account import Credentials
        except ImportError as exc:
            raise RuntimeError("Install scraper/requirements.txt before using Google Sheets") from exc

        info = _service_account_info()
        credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if info:
            credentials = Credentials.from_service_account_info(info, scopes=self.SCOPES)
        elif credentials_path:
            credentials = Credentials.from_service_account_file(credentials_path, scopes=self.SCOPES)
        else:
            raise RuntimeError(
                "Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or the GOOGLE_* service-account variables"
            )
        client = gspread.authorize(credentials)
        try:
            workbook = client.open_by_key(spreadsheet_id)
        except PermissionError as exc:
            cause = str(exc.__cause__ or exc)
            raise RuntimeError(f"Google Sheets service-account access failed: {cause}") from exc
        self.sheet1 = workbook.worksheet(os.getenv("SHEET1_NAME", "Sheet1"))
        try:
            self.sheet3 = workbook.worksheet(os.getenv("SHEET3_NAME", "Sheet3"))
        except gspread.WorksheetNotFound:
            if not allow_create:
                raise RuntimeError("Sheet3 is missing; pass --write-sheets to permit creating it")
            self.sheet3 = workbook.add_worksheet(title=os.getenv("SHEET3_NAME", "Sheet3"), rows=1000, cols=30)
        self._sheet3_values: list[list[str]] | None = None
        self._sheet3_headers: list[str] | None = None

    def source_rows(self) -> list[SourceRow]:
        values = self.sheet1.get_all_values()
        if not values:
            return []
        result: list[SourceRow] = []
        seen: set[str] = set()
        for row_number, row in enumerate(values[1:], start=2):
            name = row[0].strip() if row else ""
            key = normalize_subreddit(name)
            if not key or key in seen:
                continue
            seen.add(key)
            result.append(SourceRow(row_number, name))
        return result

    def _load_sheet3(self) -> tuple[list[str], list[list[str]]]:
        if self._sheet3_values is None:
            self._sheet3_values = self.sheet3.get_all_values()
        values = self._sheet3_values
        headers = list(values[0]) if values else []
        self._sheet3_headers = headers
        return headers, values

    def states(self) -> dict[str, SheetState]:
        headers, values = self._load_sheet3()
        lookup = {header.strip().lower(): index for index, header in enumerate(headers)}
        subreddit_index = lookup.get("subreddit", 0)
        status_index = lookup.get("sync status")
        scraped_index = lookup.get("scraped at utc")
        states: dict[str, SheetState] = {}
        for row in values[1:]:
            if subreddit_index >= len(row):
                continue
            key = normalize_subreddit(row[subreddit_index])
            if not key:
                continue
            status = row[status_index].strip().lower() if status_index is not None and status_index < len(row) else ""
            scraped_at = parse_utc(row[scraped_index]) if scraped_index is not None and scraped_index < len(row) else None
            previous = states.get(key)
            if previous is None or (scraped_at and (previous.scraped_at is None or scraped_at > previous.scraped_at)):
                states[key] = SheetState(status=status, scraped_at=scraped_at)
        return states

    def ensure_headers(self) -> list[str]:
        headers, values = self._load_sheet3()
        if not headers:
            headers = list(SHEET3_HEADERS)
            self._ensure_sheet3_width(len(headers))
            self.sheet3.update(values=[headers], range_name=f"A1:{column_letters(len(headers))}1")
            self._sheet3_values = [headers]
            self._sheet3_headers = headers
            return headers
        if normalize_subreddit(headers[0]) != "subreddit":
            raise RuntimeError("Sheet3 column A must be 'Subreddit'; no data was written")
        lower = {header.strip().lower() for header in headers}
        additions = [header for header in SHEET3_HEADERS if header.lower() not in lower]
        if additions:
            start = len(headers) + 1
            end = len(headers) + len(additions)
            self._ensure_sheet3_width(end)
            self.sheet3.update(
                values=[additions],
                range_name=f"{column_letters(start)}1:{column_letters(end)}1",
            )
            headers.extend(additions)
            if self._sheet3_values:
                self._sheet3_values[0] = headers
        self._sheet3_headers = headers
        return headers

    def _ensure_sheet3_width(self, required_columns: int) -> None:
        """Expand the physical grid before writing newly managed columns."""
        current_columns = int(getattr(self.sheet3, "col_count", 0) or 0)
        if current_columns < required_columns:
            self.sheet3.add_cols(required_columns - current_columns)

    def write_results(self, results: Sequence[ScrapeResult]) -> None:
        if not results:
            return
        headers = self.ensure_headers()
        _, values = self._load_sheet3()
        header_lookup = {header.strip().lower(): index + 1 for index, header in enumerate(headers)}
        row_map: dict[str, list[int]] = {}
        for row_number, row in enumerate(values[1:], start=2):
            key = normalize_subreddit(row[0] if row else "")
            if key:
                row_map.setdefault(key, []).append(row_number)
        next_row = max(2, len(values) + 1)
        updates: list[dict[str, Any]] = []

        for result in results:
            key = normalize_subreddit(result.subreddit)
            target_rows = row_map.get(key)
            if not target_rows:
                target_rows = [next_row]
                row_map[key] = target_rows
                next_row += 1

            managed = result.sheet_values()
            if result.status != "success":
                managed = {
                    "Subreddit": result.subreddit,
                    "Scraped At UTC": result.scraped_at_utc,
                    "Sync Status": result.status,
                    "Sync Error": result.error,
                }
            for target_row in target_rows:
                for header, value in managed.items():
                    column = header_lookup.get(header.lower())
                    if column is None:
                        continue
                    updates.append({
                        "range": f"{column_letters(column)}{target_row}",
                        "values": [["" if value is None else value]],
                    })

        for start in range(0, len(updates), 400):
            self.sheet3.batch_update(updates[start:start + 400], value_input_option="RAW")

        sheet1_updates: list[dict[str, Any]] = []
        for result in results:
            if result.status != "success":
                continue
            if result.source_row < 2:
                continue
            if result.subscribers is not None:
                sheet1_updates.append({"range": f"D{result.source_row}", "values": [[result.subscribers]]})
            if result.has_bot_bouncer is not None:
                sheet1_updates.append({
                    "range": f"F{result.source_row}",
                    "values": [["yes" if result.has_bot_bouncer else "no"]],
                })
        if sheet1_updates:
            self.sheet1.batch_update(sheet1_updates, value_input_option="RAW")


class MySQLStore:
    FIELD_MAP = {
        "subscribers": "subscribers",
        "btv": "btv",
        "tsdi": "tsdi",
        "upvote_comment_ratio": "upvote_comment_ratio",
        "min_post_karma": "min_post_karma",
        "min_comment_karma": "min_comment_karma",
        "min_combined_karma": "min_combined_karma",
        "min_account_age_days": "min_account_age_days",
        "observed_accounts": "observed_accounts",
        "has_bot_bouncer": "has_bot_bouncer",
        "requires_verification": "requires_verification",
        "weekly_top_1_upvotes": "hot_1_weekly",
        "weekly_top_2_5_avg_upvotes": "hot_2_5_weekly_avg",
        "weekly_top_6_10_avg_upvotes": "hot_6_10_weekly_avg",
        "weekly_top_10_posts": "weekly_top_10_json",
        "allows_cta_captions": "allows_cta_captions",
        "cta_match_count": "cta_match_count",
        "cta_sample_size": "cta_sample_size",
        "scraped_at_utc": "last_scraped_at",
        "status": "last_scrape_status",
        "error": "last_scrape_error",
    }

    def __init__(self, sync_mode: str) -> None:
        try:
            import mysql.connector
        except ImportError as exc:
            raise RuntimeError("Install scraper/requirements.txt before using MySQL") from exc
        required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]
        missing = [name for name in required if not os.getenv(name)]
        if missing:
            raise RuntimeError(f"Missing database environment variables: {', '.join(missing)}")
        config: dict[str, Any] = {
            "host": os.environ["DB_HOST"],
            "port": int(os.getenv("DB_PORT") or "3306"),
            "user": os.environ["DB_USER"],
            "password": os.environ["DB_PASSWORD"],
            "database": os.environ["DB_NAME"],
            "connection_timeout": 20,
            "autocommit": False,
        }
        if os.getenv("DB_SSL_CA"):
            config["ssl_ca"] = os.environ["DB_SSL_CA"]
            config["ssl_verify_cert"] = os.getenv("DB_SSL_VERIFY_CERT", "true").lower() == "true"
        self.connection = mysql.connector.connect(**config)
        self.sync_mode = sync_mode
        self.columns = self._columns()
        if "subreddit_name" not in self.columns:
            raise RuntimeError("master_subreddits.subreddit_name is missing; no database data was written")

    def _columns(self) -> set[str]:
        cursor = self.connection.cursor()
        try:
            cursor.execute(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='master_subreddits'",
                (os.environ["DB_NAME"],),
            )
            return {row[0] for row in cursor.fetchall()}
        finally:
            cursor.close()

    @staticmethod
    def _db_value(field_name: str, value: Any) -> Any:
        if field_name == "weekly_top_10_posts":
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if field_name in {"has_bot_bouncer", "requires_verification", "allows_cta_captions"}:
            return None if value is None else int(bool(value))
        if field_name == "scraped_at_utc":
            parsed = parse_utc(value)
            return parsed.replace(tzinfo=None) if parsed else None
        return value

    def write_results(self, results: Sequence[ScrapeResult]) -> tuple[int, int]:
        successful = [result for result in results if result.status == "success"]
        if not successful:
            return 0, 0
        cursor = self.connection.cursor()
        updated = inserted = 0
        try:
            names = [normalize_subreddit(result.subreddit) for result in successful]
            placeholders = ",".join(["%s"] * len(names))
            cursor.execute(
                f"SELECT subreddit_name FROM master_subreddits WHERE LOWER(subreddit_name) IN ({placeholders})",
                names,
            )
            existing = {normalize_subreddit(row[0]) for row in cursor.fetchall()}

            for result in successful:
                key = normalize_subreddit(result.subreddit)
                available: list[tuple[str, Any]] = []
                for field_name, column in self.FIELD_MAP.items():
                    if column not in self.columns:
                        continue
                    value = self._db_value(field_name, getattr(result, field_name))
                    if value is not None:
                        available.append((column, value))

                if key in existing:
                    if not available:
                        continue
                    assignments = ", ".join(f"`{column}`=%s" for column, _ in available)
                    cursor.execute(
                        f"UPDATE master_subreddits SET {assignments} WHERE LOWER(subreddit_name)=%s",
                        [value for _, value in available] + [key],
                    )
                    updated += cursor.rowcount
                elif self.sync_mode == "upsert":
                    insert_columns = ["subreddit_name"] + [column for column, _ in available]
                    insert_values = [result.subreddit] + [value for _, value in available]
                    if "status" in self.columns:
                        insert_columns.append("status")
                        insert_values.append(os.getenv("DB_NEW_ROW_STATUS", "pending"))
                    sql_columns = ", ".join(f"`{column}`" for column in insert_columns)
                    sql_values = ", ".join(["%s"] * len(insert_values))
                    cursor.execute(
                        f"INSERT INTO master_subreddits ({sql_columns}) VALUES ({sql_values})",
                        insert_values,
                    )
                    inserted += cursor.rowcount
                else:
                    LOG.warning("DB update-only mode skipped missing r/%s", key)
            self.connection.commit()
            return updated, inserted
        except Exception:
            self.connection.rollback()
            raise
        finally:
            cursor.close()

    def close(self) -> None:
        self.connection.close()


def select_sources(
    sources: Sequence[SourceRow],
    states: dict[str, SheetState],
    *,
    stale_after: timedelta,
    maximum: int,
    force: bool,
    start_after_row: int,
) -> list[SourceRow]:
    cutoff = utc_now() - stale_after
    candidates: list[SourceRow] = []
    for source in sources:
        state = states.get(source.key)
        fresh = bool(state and state.status == "success" and state.scraped_at and state.scraped_at >= cutoff)
        if force or not fresh:
            candidates.append(source)
    if not candidates:
        return []
    after = [source for source in candidates if source.sheet_row > start_after_row]
    before = [source for source in candidates if source.sheet_row <= start_after_row]
    ordered = after + before
    return ordered[:maximum] if maximum > 0 else ordered


def load_checkpoint(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-sheets", action="store_true", help="Batch-write Sheet1 and Sheet3")
    parser.add_argument("--write-db", action="store_true", help="Write master_subreddits in one transaction")
    parser.add_argument("--db-sync-mode", choices=("update-only", "upsert"), default=os.getenv("DB_SYNC_MODE", "update-only"))
    parser.add_argument("--subreddit", action="append", default=[], help="Analyze only this subreddit; repeatable")
    parser.add_argument("--max-subreddits", type=int, default=int(os.getenv("MAX_SUBREDDITS_PER_RUN", "10")))
    parser.add_argument("--stale-after-hours", type=int, default=int(os.getenv("SYNC_STALE_AFTER_HOURS", "168")))
    parser.add_argument("--hot-limit", type=int, default=int(os.getenv("HOT_LIMIT", "25")))
    parser.add_argument("--new-limit", type=int, default=int(os.getenv("NEW_LIMIT", "25")))
    parser.add_argument("--exact-root-comments", action="store_true", help="Slower: fetch comment trees for an exact root-comment ratio")
    parser.add_argument("--force", action="store_true", help="Ignore successful freshness checkpoints")
    parser.add_argument("--plan-only", action="store_true", help="List selected rows without calling Reddit or writing")
    parser.add_argument("--checkpoint", type=Path, default=Path(os.getenv("SYNC_CHECKPOINT", "output/subreddit_sync_checkpoint.json")))
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--retry-attempts", type=int, default=int(os.getenv("RETRY_ATTEMPTS", "4")))
    parser.add_argument("--retry-base-delay", type=float, default=float(os.getenv("RETRY_BASE_DELAY", "3")))
    parser.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default=os.getenv("LOG_LEVEL", "INFO"))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )
    run_id = uuid.uuid4().hex[:12]
    report_path = args.report or Path("output") / f"subreddit_sync_{run_id}.json"
    checkpoint = load_checkpoint(args.checkpoint)

    spreadsheet_id = os.getenv("SPREADSHEET_ID", "").strip()
    sheet_store: GoogleSheetStore | None = None
    if args.subreddit:
        requested = [name for name in args.subreddit if normalize_subreddit(name)]
        if args.write_sheets:
            if not spreadsheet_id:
                LOG.error("SPREADSHEET_ID is required for --write-sheets")
                return 2
            sheet_store = GoogleSheetStore(spreadsheet_id, allow_create=True)
            sheet_sources = {source.key: source for source in sheet_store.source_rows()}
            sources = [sheet_sources.get(normalize_subreddit(name), SourceRow(0, name)) for name in requested]
        else:
            sources = [SourceRow(0, name) for name in requested]
        states: dict[str, SheetState] = {}
    else:
        if not spreadsheet_id:
            LOG.error("SPREADSHEET_ID is required when --subreddit is not supplied")
            return 2
        sheet_store = GoogleSheetStore(spreadsheet_id, allow_create=args.write_sheets)
        sources = sheet_store.source_rows()
        states = sheet_store.states()

    selected = select_sources(
        sources,
        states,
        stale_after=timedelta(hours=max(0, args.stale_after_hours)),
        maximum=max(0, args.max_subreddits),
        force=args.force or bool(args.subreddit),
        start_after_row=int(checkpoint.get("last_source_row", 1) or 1),
    )
    LOG.info("Run %s selected %s of %s source rows", run_id, len(selected), len(sources))
    for source in selected:
        LOG.info("Selected Sheet1 row %s: r/%s", source.sheet_row, source.key)

    if args.plan_only:
        atomic_write_json(report_path, {"run_id": run_id, "mode": "plan", "selected": [asdict(row) for row in selected]})
        LOG.info("Plan report: %s", report_path.resolve())
        return 0
    if not selected:
        atomic_write_json(report_path, {"run_id": run_id, "mode": "no-op", "selected": []})
        LOG.info("Every row is fresh; report: %s", report_path.resolve())
        return 0

    analyzer = RedditAnalyzer(
        hot_limit=max(1, min(args.hot_limit, 100)),
        new_limit=max(1, min(args.new_limit, 100)),
        exact_root_comments=args.exact_root_comments,
        retry_attempts=max(1, args.retry_attempts),
        retry_base_delay=max(0.1, args.retry_base_delay),
    )

    results: list[ScrapeResult] = []
    for position, source in enumerate(selected, start=1):
        LOG.info("[%s/%s] Analyzing r/%s", position, len(selected), source.key)
        try:
            result = analyzer.analyze(source)
            LOG.info(
                "r/%s success: members=%s btv=%s weekly_top1=%s observed_accounts=%s",
                source.key,
                result.subscribers,
                result.btv,
                result.weekly_top_1_upvotes,
                result.observed_accounts,
            )
        except Exception as exc:
            LOG.error("r/%s failed: %s", source.key, exc)
            result = ScrapeResult.failed(source, exc)
        results.append(result)
        atomic_write_json(
            args.checkpoint,
            {
                "run_id": run_id,
                "last_source_row": source.sheet_row,
                "last_subreddit": source.key,
                "last_status": result.status,
                "updated_at_utc": utc_now().isoformat().replace("+00:00", "Z"),
            },
        )

    if args.write_sheets:
        if sheet_store is None:
            if not spreadsheet_id:
                LOG.error("SPREADSHEET_ID is required for --write-sheets")
                return 2
            sheet_store = GoogleSheetStore(spreadsheet_id, allow_create=True)
        sheet_store.write_results(results)
        LOG.info("Google Sheets batch update completed")
    else:
        LOG.info("Google Sheets dry-run: no values changed")

    db_counts = {"updated": 0, "inserted": 0}
    if args.write_db:
        database = MySQLStore(args.db_sync_mode)
        try:
            updated, inserted = database.write_results(results)
            db_counts = {"updated": updated, "inserted": inserted}
            LOG.info("MySQL transaction committed: updated=%s inserted=%s", updated, inserted)
        finally:
            database.close()
    else:
        LOG.info("MySQL dry-run: no rows changed")

    report = {
        "run_id": run_id,
        "started_from_checkpoint": checkpoint,
        "finished_at_utc": utc_now().isoformat().replace("+00:00", "Z"),
        "write_sheets": args.write_sheets,
        "write_db": args.write_db,
        "db_sync_mode": args.db_sync_mode,
        "db_counts": db_counts,
        "success_count": sum(result.status == "success" for result in results),
        "error_count": sum(result.status != "success" for result in results),
        "results": [asdict(result) for result in results],
    }
    atomic_write_json(report_path, report)
    LOG.info("Verified report artifact: %s", report_path.resolve())
    return 1 if report["error_count"] else 0


if __name__ == "__main__":
    sys.exit(main())
