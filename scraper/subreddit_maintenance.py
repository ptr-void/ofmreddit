"""Conservative archival, discovery review, and idempotent Sheet1 queue processing.

No physical deletes. Archived rows retain their values and are hidden in Sheet1.
The default command only probes and reports. --apply enables durable actions.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re

try:
    from scraper.subreddit_sync import (
        GoogleSheetStore, RedditAnalyzer, atomic_write_json, column_letters,
        normalize_subreddit, parse_subscriber_count, utc_now,
    )
    from scraper.migrate_schema import connection_config
except ModuleNotFoundError:
    from subreddit_sync import (
        GoogleSheetStore, RedditAnalyzer, atomic_write_json, column_letters,
        normalize_subreddit, parse_subscriber_count, utc_now,
    )
    from migrate_schema import connection_config

UTC = timezone.utc
CHECK_INTERVAL = timedelta(hours=24)
MIN_DEAD_SPAN = timedelta(hours=48)
MIN_DEAD_CHECKS = 3
MAX_ARCHIVES = 5
NAME = re.compile(r'^[A-Za-z0-9_]{2,21}$')


def aware(value):
    return value.replace(tzinfo=UTC) if value and value.tzinfo is None else value


def json_text(value):
    return json.dumps(value, default=str, ensure_ascii=False)


@dataclass
class Probe:
    outcome: str  # alive, dead, or uncertain
    evidence: str


def probe_subreddit(analyzer, name):
    """A zero count, private response, rate limit, or transport error is NOT dead."""
    try:
        sub = analyzer.reddit.subreddit(name)
        analyzer._call(sub._fetch, f'r/{name} availability')
        if normalize_subreddit(str(sub.display_name)) != name:
            return Probe('uncertain', 'Reddit identity mismatch')
        return Probe('alive', 'Reddit returned matching community metadata')
    except Exception as exc:
        response = getattr(exc, 'response', None)
        if getattr(response, 'status_code', None) != 404:
            return Probe('uncertain', f'{type(exc).__name__}: {str(exc)[:180]}')
        try:
            reason = str(response.json().get('reason', '')).lower()
        except (ValueError, AttributeError):
            reason = ''
        if reason == 'banned':
            return Probe('dead', 'Reddit about endpoint explicitly reports banned (404)')
        if reason in {'private', 'quarantined', 'restricted'}:
            return Probe('uncertain', f'Reddit reports {reason}')
        try:
            matches = analyzer._call(
                lambda: list(analyzer.reddit.subreddits.search_by_name(name, exact=True)),
                f'r/{name} exact name lookup',
            )
            if any(normalize_subreddit(str(item)) == name for item in matches):
                return Probe('uncertain', 'About returned 404 but exact name lookup still finds it')
            return Probe('dead', 'About returned 404 and exact name lookup returned no matching community')
        except Exception as lookup_error:
            return Probe('uncertain', f'Exact lookup inconclusive: {type(lookup_error).__name__}')


def next_observation(previous, probe, now):
    """Count separated evidence, reset on recovery/uncertainty, and honor restores."""
    current = dict(previous)
    current.update(last_checked_at=now, last_evidence=probe.evidence)
    if probe.outcome != 'dead':
        current.update(dead_checks=0, first_dead_at=None, last_dead_at=None)
        if current.get('state') != 'archived':
            current['state'] = 'active'
        return current, False
    hold = aware(current.get('hold_until'))
    if hold and now < hold:
        return current, False
    last = aware(current.get('last_dead_at'))
    if last and now - last < CHECK_INTERVAL:
        return current, False
    first = aware(current.get('first_dead_at')) or now
    checks = int(current.get('dead_checks') or 0) + 1
    current.update(dead_checks=checks, first_dead_at=first, last_dead_at=now)
    if current.get('state') != 'archived':
        current['state'] = 'watch'
    eligible = checks >= MIN_DEAD_CHECKS and now - first >= MIN_DEAD_SPAN
    return current, eligible


def candidate_eligible(metadata, now, minimum_members=100, max_age_days=30):
    members = parse_subscriber_count(metadata.get('subscribers'))
    posted = metadata.get('latest_post_utc')
    return bool(
        NAME.fullmatch(metadata.get('name', ''))
        and metadata.get('over18') is True
        and metadata.get('subreddit_type') == 'public'
        and members is not None and members >= minimum_members
        and isinstance(posted, (float, int))
        and 0 <= now.timestamp() - posted <= max_age_days * 86400
    )


class Maintenance:
    def __init__(self, store, analyzer, connection, *, apply=False):
        self.store, self.analyzer, self.connection = store, analyzer, connection
        self.apply = apply
        self.report = {'started_at': utc_now().isoformat(), 'apply': apply,
                       'checks': [], 'actions': [], 'discovered': [], 'errors': []}

    def sql(self, statement, params=()):
        with self.connection.cursor(dictionary=True) as cursor:
            cursor.execute(statement, params)
            return cursor.fetchall() if cursor.with_rows else []

    def event(self, name, action, detail):
        self.report['actions'].append({'subreddit': name, 'action': action})
        self.sql('INSERT INTO subreddit_maintenance_events (subreddit_name, action, detail_json) VALUES (%s,%s,%s)',
                 (name, action, json_text(detail)))

    def table(self):
        self.store._sheet1_values = None
        headers, matrix = self.store._load_sheet1()
        lookup = {h.strip().lower(): i for i, h in enumerate(headers)}
        for required in ('subreddit', 'sync status', 'sync error', 'scraped at utc'):
            if required not in lookup:
                raise RuntimeError(f'Missing required table column: {required}')
        rows = {}
        for number, row in enumerate(matrix[1:], 2):
            key = normalize_subreddit(row[lookup['subreddit']] if len(row) > lookup['subreddit'] else '')
            if key:
                rows.setdefault(key, []).append((number, row))
        return headers, lookup, rows

    def set_visibility(self, name, *, archived):
        headers, lookup, rows = self.table()
        matches = rows.get(name, [])
        if not matches:
            raise RuntimeError(f'No current Sheet row for r/{name}; preserving archive for review')
        updates, requests = [], []
        for number, _ in matches:
            for field, value in [('sync status', 'archived' if archived else ''),
                                 ('sync error', 'Archived after repeated availability checks' if archived else '')]:
                updates.append({'range': f'{column_letters(lookup[field] + 1)}{number}', 'values': [[value]]})
            if not archived:
                updates.append({'range': f'{column_letters(lookup["scraped at utc"] + 1)}{number}', 'values': [['']]})
            requests.append({'updateDimensionProperties': {
                'range': {'sheetId': self.store.sheet1.id, 'dimension': 'ROWS',
                          'startIndex': number - 1, 'endIndex': number},
                'properties': {'hiddenByUser': archived}, 'fields': 'hiddenByUser',
            }})
        self.store.sheet1.batch_update(updates, value_input_option='RAW')
        self.store.workbook.batch_update({'requests': requests})
        _, checked_lookup, checked_rows = self.table()
        expected = 'archived' if archived else ''
        for _, row in checked_rows.get(name, []):
            status = row[checked_lookup['sync status']] if len(row) > checked_lookup['sync status'] else ''
            if status != expected:
                raise RuntimeError(f'Sheet status readback mismatch for r/{name}')

    def archive(self, name, record):
        headers, _, rows = self.table()
        if name not in rows:
            return
        snapshot = {'headers': headers, 'rows': [row for _, row in rows[name]],
                    'archived_at': utc_now().isoformat()}
        # Durable snapshot and exclusion BEFORE Sheet writes; retries finish partial work.
        self.sql("UPDATE subreddit_maintenance SET state='archived', archived_at=UTC_TIMESTAMP(), "
                 'archive_json=%s WHERE subreddit_name=%s', (json_text(snapshot), name))
        self.event(name, 'archive', {'evidence': record['last_evidence'], 'checks': record['dead_checks']})
        self.set_visibility(name, archived=True)

    def append_row(self, name, data):
        headers, _, rows = self.table()
        if name in rows:
            return
        mapped = {str(key).strip().lower(): value for key, value in data.items()}
        mapped['subreddit'] = name
        mapped['link'] = f'https://www.reddit.com/r/{name}/'
        # Never carry an old checkpoint into a new active row.
        for field in ('sync status', 'sync error', 'scraped at utc'):
            mapped[field] = ''
        row = [mapped.get(header.strip().lower(), '') for header in headers]
        self.store.sheet1.append_rows([row], value_input_option='RAW', insert_data_option='INSERT_ROWS')
        _, _, verified = self.table()
        if name not in verified:
            raise RuntimeError(f'Append readback mismatch for r/{name}')
        # Keep the single styled Google Sheets table inclusive of appended rows.
        metadata = self.store.workbook.fetch_sheet_metadata(params={'includeGridData': 'false'})
        requests = []
        end_row = max(number for matches in verified.values() for number, _ in matches)
        for sheet in metadata.get('sheets', []):
            if sheet.get('properties', {}).get('sheetId') != self.store.sheet1.id:
                continue
            for table in sheet.get('tables', []):
                target = dict(table['range'])
                target['endRowIndex'] = max(target.get('endRowIndex', 0), end_row)
                requests.append({'updateTable': {'table': {'tableId': table['tableId'], 'range': target}, 'fields': 'range'}})
        if requests:
            self.store.workbook.batch_update({'requests': requests})
        self.store.format_numeric_columns(headers)

    def restore(self, name, record):
        _, _, rows = self.table()
        if name not in rows:
            snapshot = json.loads(record.get('archive_json') or '{}')
            if not snapshot.get('rows'):
                raise RuntimeError(f'No saved row for r/{name}; manual review needed')
            self.append_row(name, dict(zip(snapshot['headers'], snapshot['rows'][0])))
        self.set_visibility(name, archived=False)
        self.sql("UPDATE subreddit_maintenance SET state='active', dead_checks=0, first_dead_at=NULL, "
                 'last_dead_at=NULL, archived_at=NULL, requested_action=NULL, '
                 'hold_until=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 72 HOUR) WHERE subreddit_name=%s', (name,))
        self.event(name, 'restore', {'hold_hours': 72})

    def process_queue(self):
        queued = self.sql('SELECT * FROM subreddit_maintenance WHERE requested_action IS NOT NULL ORDER BY updated_at LIMIT 20')
        for item in queued:
            name = item['subreddit_name']
            if not self.apply:
                self.report['actions'].append({'subreddit': name, 'queued': item['requested_action']})
                continue
            try:
                if item['requested_action'] == 'restore':
                    self.restore(name, item)
                elif item['requested_action'] == 'add' and item['state'] != 'archived':
                    master = self.sql("SELECT * FROM master_subreddits WHERE LOWER(subreddit_name)=%s AND status='pending'", (name,))
                    if not master:
                        self.sql('UPDATE subreddit_maintenance SET requested_action=NULL WHERE subreddit_name=%s', (name,))
                        continue
                    sub = master[0]
                    # Recheck before publication, retaining the queued item on an inconclusive result.
                    if probe_subreddit(self.analyzer, name).outcome != 'alive':
                        self.report['errors'].append(f'r/{name}: approval waits for matching live metadata')
                        continue
                    self.append_row(name, {'Total Members': sub['subscribers'], 'Niche': sub.get('niche_tags') or ''})
                    self.sql("UPDATE master_subreddits SET status='approved' WHERE id=%s AND status='pending'", (sub['id'],))
                    self.sql("UPDATE subreddit_maintenance SET requested_action=NULL, state='active' WHERE subreddit_name=%s", (name,))
                    self.event(name, 'approved_and_added', {})
            except Exception as exc:
                self.report['errors'].append(f'r/{name}: {str(exc)[:250]}')

    def cleanup(self, maximum):
        # A working, unrelated public subreddit is required before counting evidence.
        if probe_subreddit(self.analyzer, 'redditdev').outcome != 'alive':
            self.report['errors'].append('Availability canary inconclusive; cleanup deferred')
            return
        _, lookup, rows = self.table()
        records = {item['subreddit_name']: item for item in self.sql('SELECT * FROM subreddit_maintenance')}
        now, targets = utc_now(), []
        for name, matches in rows.items():
            if not NAME.fullmatch(name):
                continue
            statuses = {row[lookup['sync status']].lower() if len(row) > lookup['sync status'] else '' for _, row in matches}
            record = records.get(name, {'subreddit_name': name, 'state': 'active'})
            if record.get('state') != 'archived' and 'error' not in statuses and 'archived' not in statuses:
                if record.get('dead_checks') and 'success' in statuses and self.apply:
                    self.sql("UPDATE subreddit_maintenance SET state='active', dead_checks=0, first_dead_at=NULL, last_dead_at=NULL WHERE subreddit_name=%s", (name,))
                continue
            last = aware(record.get('last_checked_at'))
            if last and now - last < CHECK_INTERVAL:
                continue
            targets.append((last or datetime.min.replace(tzinfo=UTC), name, record))
        archived_count = 0
        for _, name, record in sorted(targets)[:maximum]:
            probe = probe_subreddit(self.analyzer, name)
            updated, eligible = next_observation(record, probe, now)
            self.report['checks'].append({'subreddit': name, **probe.__dict__, 'dead_checks': updated.get('dead_checks', 0), 'eligible': eligible})
            if not self.apply:
                continue
            self.sql('INSERT INTO subreddit_maintenance (subreddit_name, state, dead_checks, first_dead_at, last_dead_at, last_checked_at, last_evidence) '
                     'VALUES (%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE state=VALUES(state), dead_checks=VALUES(dead_checks), '
                     'first_dead_at=VALUES(first_dead_at), last_dead_at=VALUES(last_dead_at), last_checked_at=VALUES(last_checked_at), last_evidence=VALUES(last_evidence)',
                     (name, updated.get('state', 'active'), updated.get('dead_checks', 0), updated.get('first_dead_at'),
                      updated.get('last_dead_at'), now, probe.evidence))
            try:
                if record.get('state') == 'archived':
                    if probe.outcome == 'alive':
                        self.restore(name, record)
                    else:
                        self.set_visibility(name, archived=True)
                elif eligible and archived_count < MAX_ARCHIVES:
                    archived_count += 1
                    self.archive(name, updated)
            except Exception as exc:
                self.report['errors'].append(f'r/{name}: {str(exc)[:250]}')

    def discover(self, limit):
        if limit <= 0:
            return
        control = self.sql('SELECT * FROM subreddit_maintenance_control WHERE id=1')[0]
        last = aware(control.get('last_discovery_at'))
        now = utc_now()
        if last and now - last < timedelta(hours=24):
            self.report['discovery_status'] = 'Daily discovery already completed'
            return
        headers, lookup, rows = self.table()
        # Reuse curated niche vocabulary, never infer or overwrite niche tags.
        niches = set()
        if 'niche' in lookup:
            for matches in rows.values():
                for _, row in matches:
                    value = row[lookup['niche']] if len(row) > lookup['niche'] else ''
                    niches.update(tag.strip().lower() for tag in value.split(',') if tag.strip())
        queries = sorted(niches) or ['nsfw']
        position = int(control['discovery_cursor']) % len(queries)
        query = queries[position]
        known = set(rows)
        known.update(normalize_subreddit(r['subreddit_name']) for r in self.sql('SELECT subreddit_name FROM master_subreddits'))
        known.update(r['subreddit_name'] for r in self.sql('SELECT subreddit_name FROM subreddit_maintenance'))
        candidates = self.analyzer._call(
            lambda: list(self.analyzer.reddit.subreddits.search(query, limit=25, params={'include_over_18': 'on'})),
            'Discovery search',
        )
        minimum = int(os.getenv('DISCOVERY_MIN_MEMBERS', '100'))
        max_age = int(os.getenv('DISCOVERY_MAX_POST_AGE_DAYS', '30'))
        for sub in candidates:
            name = normalize_subreddit(str(sub.display_name))
            if name in known or not NAME.fullmatch(name):
                continue
            try:
                # Explicit metadata fetch rather than trusting a search listing's cached fields.
                self.analyzer._call(sub._fetch, f'r/{name} discovery metadata')
                metadata = {'name': name, 'over18': bool(sub.over18), 'subreddit_type': sub.subreddit_type,
                            'subscribers': parse_subscriber_count(getattr(sub, 'subscribers', None)), 'query': query}
                if not metadata['over18'] or metadata['subreddit_type'] != 'public' or (metadata['subscribers'] or 0) < minimum:
                    continue
                posts = self.analyzer._call(lambda: list(sub.new(limit=5)), f'r/{name} discovery activity')
                surviving = [float(p.created_utc) for p in posts if not getattr(p, 'removed_by_category', None)]
                metadata['latest_post_utc'] = max(surviving) if surviving else None
                if not candidate_eligible(metadata, now, minimum, max_age):
                    continue
                if self.apply:
                    # Do not overwrite an existing approval/rejection or curated tags.
                    self.sql("INSERT IGNORE INTO master_subreddits (subreddit_name, niche_tags, subscribers, is_nsfw, status) VALUES (%s,'',%s,1,'pending')",
                             (name, metadata['subscribers']))
                    self.sql('INSERT INTO subreddit_maintenance (subreddit_name, discovery_json) VALUES (%s,%s) '
                             'ON DUPLICATE KEY UPDATE discovery_json=VALUES(discovery_json)', (name, json_text(metadata)))
                    self.event(name, 'discovered_for_review', metadata)
                known.add(name)
                self.report['discovered'].append(metadata)
                if len(self.report['discovered']) >= limit:
                    break
            except Exception as exc:
                self.report['errors'].append(f'Discovery r/{name}: {type(exc).__name__}')
        if self.apply:
            self.sql('UPDATE subreddit_maintenance_control SET last_discovery_at=UTC_TIMESTAMP(), discovery_cursor=%s WHERE id=1', (position + 1,))
        self.report['discovery_query'] = query


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--max-checks', type=int, default=20)
    parser.add_argument('--discovery-limit', type=int, default=5)
    args = parser.parse_args()
    if not 0 <= args.max_checks <= 100 or not 0 <= args.discovery_limit <= 20:
        parser.error('Use 0..100 availability checks and 0..20 discoveries')
    import mysql.connector
    connection = mysql.connector.connect(**connection_config())
    maintenance = None
    locked = False
    try:
        store = GoogleSheetStore(os.environ['SPREADSHEET_ID'])
        analyzer = RedditAnalyzer(new_limit=25, retry_attempts=3, retry_base_delay=5)
        maintenance = Maintenance(store, analyzer, connection, apply=args.apply)
        locked = maintenance.sql("SELECT GET_LOCK('ofmreddit_maintenance',0) AS acquired")[0]['acquired'] == 1
        if not locked:
            print('Another maintenance worker is active; deferred.')
            return 0
        maintenance.process_queue()
        maintenance.cleanup(args.max_checks)
        maintenance.discover(args.discovery_limit)
        return 1 if maintenance.report['errors'] else 0
    finally:
        if maintenance:
            report_path = Path('output') / f'subreddit-maintenance-{utc_now():%Y%m%dT%H%M%S%fZ}.json'
            atomic_write_json(report_path, maintenance.report)
            print(json_text(maintenance.report))
            print(f'Report: {report_path.resolve()}')
            if locked:
                maintenance.sql("SELECT RELEASE_LOCK('ofmreddit_maintenance')")
        connection.close()


if __name__ == '__main__':
    raise SystemExit(main())
