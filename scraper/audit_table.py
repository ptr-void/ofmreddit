"""Read-only structural audit of every current Sheet row; never edits curated data."""
import os
from pathlib import Path
import re
try:
    from scraper.subreddit_sync import GoogleSheetStore, NUMERIC_SHEET_HEADERS, atomic_write_json, normalize_subreddit, utc_now
except ModuleNotFoundError:
    from subreddit_sync import GoogleSheetStore, NUMERIC_SHEET_HEADERS, atomic_write_json, normalize_subreddit, utc_now


def audit_table(matrix):
    if not matrix:
        raise ValueError('Empty table')
    lookup = {h.strip().lower(): i for i, h in enumerate(matrix[0])}
    if 'subreddit' not in lookup:
        raise ValueError('Missing subreddit column')
    findings, names = [], {}
    for number, row in enumerate(matrix[1:], 2):
        value = lambda key: row[lookup[key]] if key in lookup and len(row) > lookup[key] else ''
        name = normalize_subreddit(value('subreddit'))
        if not name:
            findings.append({'row': number, 'issue': 'missing_name'})
            continue
        names.setdefault(name, []).append(number)
        if not re.fullmatch(r'[a-z0-9_]{2,21}', name):
            findings.append({'row': number, 'subreddit': name, 'issue': 'invalid_name'})
        link = value('link').strip()
        link_name = normalize_subreddit(link).split('/')[0]
        if link and link_name != name:
            findings.append({'row': number, 'subreddit': name, 'issue': 'link_name_mismatch', 'link': link})
        for header in NUMERIC_SHEET_HEADERS:
            text = value(header).strip()
            pattern = r'(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?'
            if 'karma' in header:
                pattern = '-?' + pattern
            if text and not re.fullmatch(pattern, text):
                findings.append({'row': number, 'subreddit': name, 'issue': 'malformed_numeric', 'column': header, 'value': text})
        # Observed samples are not authoritative posting thresholds.
        for header in ('min post karma', 'min comment karma', 'min total karma'):
            text = value(header).replace(',', '')
            if text.isdigit() and int(text) >= 100000:
                findings.append({'row': number, 'subreddit': name, 'issue': 'high_observed_sample', 'column': header, 'value': text})
        if value('sync status').strip().lower() == 'error':
            findings.append({'row': number, 'subreddit': name, 'issue': 'unverified_retained_values'})
    duplicates = {name: numbers for name, numbers in names.items() if len(numbers) > 1}
    return {'rows': len(matrix) - 1, 'unique_names': len(names), 'duplicates': duplicates, 'findings': findings}


def main():
    store = GoogleSheetStore(os.environ['SPREADSHEET_ID'])
    _, matrix = store._load_sheet1()
    report = audit_table(matrix)
    report['checked_at'] = utc_now().isoformat()
    path = Path('output') / f'table-audit-{utc_now():%Y%m%dT%H%M%S%fZ}.json'
    atomic_write_json(path, report)
    counts = {}
    for finding in report['findings']:
        counts[finding['issue']] = counts.get(finding['issue'], 0) + 1
    print({'rows': report['rows'], 'unique_names': report['unique_names'], 'duplicate_names': len(report['duplicates']), 'findings': counts})
    print(f'Report: {path.resolve()}')


if __name__ == '__main__':
    main()
