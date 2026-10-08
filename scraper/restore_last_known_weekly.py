#!/usr/bin/env python3
"""Restore missing weekly cells from genuine saved data; read-only by default.

Never append carried scores as new current-week observations. Source priority:
four-week raw history, last positive saved reading, then audited legacy baseline.
The legacy baseline retains its provenance in its original worksheet.
"""
import argparse
import os
from pathlib import Path
from scraper.subreddit_sync import (GoogleSheetStore, atomic_write_json, column_letters,
    normalize_subreddit, parse_utc, retained_weekly_metrics, utc_now, WEEKLY_HISTORY_HEADERS)
from scraper.weekly_baselines import TITLE, HEADERS as BASELINE_HEADERS, stored_keys
from scraper.repair_weekly_metrics import HEADERS

def restore_plan(matrix, history, baselines, now=None):
    now = now or utc_now()
    if not matrix or not history or history[0] != WEEKLY_HISTORY_HEADERS or not baselines or baselines[0] != BASELINE_HEADERS:
        raise ValueError('Unexpected source/history/baseline headers; no repairs planned')
    lookup = {header.lower().strip(): index for index, header in enumerate(matrix[0])}
    ni, si = lookup['subreddit'], lookup.get('sync status', -1)
    columns = [lookup[header.lower()] for header in HEADERS]
    samples = {}
    for row in history[1:]:
        row = list(row) + [''] * max(0, 5-len(row))
        values = tuple(int(value) if str(value).strip().isdigit() else None for value in row[2:5])
        samples.setdefault(normalize_subreddit(row[0]), []).append((row[1], values))
    saved = {}
    for row in baselines[1:]:
        if not stored_keys([BASELINE_HEADERS, row], now): continue
        key = (normalize_subreddit(row[0]), row[1])
        end, observed = parse_utc(row[3]), parse_utc(row[4])
        if key not in saved or (end, observed) > saved[key][:2]: saved[key] = (end, observed, int(row[5]))
    plan = []
    for number, row in enumerate(matrix[1:], 2):
        name = normalize_subreddit(row[ni] if ni < len(row) else '')
        if not name or si >= 0 and si < len(row) and row[si].strip().lower() == 'archived': continue
        recovered = retained_weekly_metrics(samples.get(name, []), now=now)
        for column, metric, score in zip(columns, HEADERS, recovered):
            before = str(row[column]) if column < len(row) else ''
            try: positive = int(before.replace(',', '')) > 0
            except ValueError: positive = False
            if positive: continue
            provenance = 'saved weekly observations'
            if score is None and (name, metric) in saved:
                score = saved[(name, metric)][2]; provenance = 'audited saved legacy baseline'
            if score is not None and score > 0:
                plan.append({'subreddit': name, 'header': metric, 'before': before, 'after': score,
                    'range': f'{column_letters(column+1)}{number}', 'source': provenance})
    return plan

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    store = GoogleSheetStore(os.environ['SPREADSHEET_ID'])
    def read():
        store._sheet1_values = None; _, matrix = store._load_sheet1()
        history = store.workbook.worksheet('Weekly Metrics History').get_all_values()
        baselines = store.workbook.worksheet(TITLE).get_all_values()
        return matrix, history, baselines
    matrix, history, baselines = read(); plan = restore_plan(matrix, history, baselines)
    stamp=utc_now().strftime('%Y%m%dT%H%M%S%fZ'); path=Path('output')/f'last-known-weekly-restore-{stamp}.json'
    report={'spreadsheet_id':store.workbook.id,'sheet':store.sheet1.title,'apply':args.apply,'plan':plan,'verified':False}
    atomic_write_json(path,report)
    if args.apply and plan:
        backup=Path('output')/f'last-known-weekly-backup-{stamp}.json'
        # Ground native target cells, including formulas/validation, before writing.
        metadata=store.workbook.fetch_sheet_metadata(params={'includeGridData':'true',
            'ranges':[f"'{store.sheet1.title}'!{item['range']}" for item in plan],
            'fields':'sheets(properties,data(rowData(values(userEnteredValue,dataValidation))))'})
        for sheet in metadata.get('sheets',[]):
            for grid in sheet.get('data',[]):
                for row in grid.get('rowData',[]):
                    for cell in row.get('values',[]):
                        if 'formulaValue' in cell.get('userEnteredValue',{}) or cell.get('dataValidation'):
                            raise RuntimeError('Formula/validation found in target metric cells; inspect before writing')
        atomic_write_json(backup,{'source':matrix,'history':history,'baselines':baselines,'target_cells':metadata})
        fresh, new_history, new_baselines=read(); current=restore_plan(fresh,new_history,new_baselines)
        identity=lambda items:sorted((p['subreddit'],p['range'],p['before'],p['after']) for p in items)
        if identity(current)!=identity(plan): raise RuntimeError('Source readings changed; repeat plan before writing')
        store.sheet1.batch_update([{'range':p['range'],'values':[[p['after']]]} for p in current],value_input_option='RAW')
        checked, check_history, check_baselines=read()
        if len(checked) != len(fresh): raise RuntimeError('Source row count changed; inspect backup')
        if check_history!=new_history or check_baselines!=new_baselines: raise RuntimeError('History changed during repair; inspect')
        allowed={(int(''.join(c for c in p['range'] if c.isdigit()))-1, fresh[0].index(p['header'])):str(p['after']) for p in current}
        for ri,(before,after) in enumerate(zip(fresh,checked)):
            for ci in range(max(len(before),len(after))):
                a=after[ci] if ci<len(after) else ''; b=before[ci] if ci<len(before) else ''
                if (ri,ci) in allowed:
                    if a.replace(',','')!=allowed[(ri,ci)]: raise RuntimeError('Metric readback mismatch')
                elif a!=b: raise RuntimeError('Unrelated source cell changed; inspect backup')
        report.update(verified=True,backup=str(backup.resolve()),cells=len(current)); atomic_write_json(path,report)
    print(f"{'Applied' if args.apply else 'Planned'} {len(plan)} last-known weekly cells; verified={report['verified']}")
    print(f'Report: {path.resolve()}')
if __name__=='__main__': main()
