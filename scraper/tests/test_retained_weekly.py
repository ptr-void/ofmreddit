import unittest
from scraper.subreddit_sync import retained_weekly_metrics, parse_utc, GoogleSheetStore, MySQLStore, ScrapeResult, SHEET1_REQUIRED_HEADERS, column_letters
from scraper.tests.test_subreddit_sync import FakeWorksheet
from types import SimpleNamespace
from scraper.restore_last_known_weekly import restore_plan
from scraper.weekly_baselines import HEADERS

class RetainedWeeklyTests(unittest.TestCase):
    def test_empty_or_zero_current_readings_keep_published_values(self):
        now=parse_utc('2026-10-08T12:00:00Z')
        samples=[('2026-10-08T11:00:00Z',(0, None, 0))]
        self.assertEqual(retained_weekly_metrics(samples,now=now,published=(120,40,15)),(120,40,15))
    def test_stale_history_is_last_known_only_when_published_value_missing(self):
        now=parse_utc('2026-10-08T12:00:00Z')
        samples=[('2026-06-08T12:00:00Z',(120,40,15)),('2026-10-09T12:00:00Z',(9999,9999,9999))]
        self.assertEqual(retained_weekly_metrics(samples,now=now,published=(150,None,None)),(150,40,15))
        self.assertEqual(retained_weekly_metrics([],now=now),(None,None,None))
    def test_new_positive_week_updates_only_available_metrics(self):
        now=parse_utc('2026-10-08T12:00:00Z')
        self.assertEqual(retained_weekly_metrics([('2026-10-08T11:00:00Z',(200,None,0))],now=now,published=(120,40,15)),(200,40,15))
    def test_early_week_is_not_imported_as_last_known_data(self):
        now=parse_utc('2026-10-06T12:00:00Z')
        self.assertEqual(retained_weekly_metrics([('2026-10-05T11:00:00Z',(2,2,2))],now=now),(None,None,None))
    def test_direct_zero_weekly_write_preserves_sheet_but_genuine_zero_karma_is_allowed(self):
        store=object.__new__(GoogleSheetStore); headers=list(SHEET1_REQUIRED_HEADERS)
        store._sheet1_values=None; store.sheet1=FakeWorksheet(values=[headers,['example']]); store._sheet1_headers=headers
        result=ScrapeResult(subreddit='example',source_row=2,scraped_at_utc='2026-10-08T12:00:00Z',weekly_top_1_upvotes=0,weekly_top_2_5_avg_upvotes=0,weekly_top_6_10_avg_upvotes=0,min_post_karma=0)
        store.write_results([result]); updates={item['range']:item['values'] for batch,_ in store.sheet1.batch_updates for item in batch}
        for header in ('Hot 1 (Weekly)','Hot 2-5 Avg (Weekly)','Hot 6-10 Avg (Weekly)'):
            self.assertNotIn(f'{column_letters(headers.index(header)+1)}2',updates)
        self.assertEqual(updates[f'{column_letters(headers.index("Min Post Karma")+1)}2'],[[0]])
    def test_zero_weekly_values_are_not_written_into_mysql_mirror(self):
        calls=[]
        cursor=SimpleNamespace(execute=lambda sql,values: calls.append((sql,values)),fetchall=lambda:[('example',)],rowcount=1,close=lambda:None)
        store=object.__new__(MySQLStore); store.connection=SimpleNamespace(cursor=lambda:cursor,commit=lambda:None,rollback=lambda:None)
        store.columns={'subreddit_name','hot_1_weekly','min_post_karma'}; store.sync_mode='update-only'
        store.write_results([ScrapeResult(subreddit='example',source_row=2,scraped_at_utc='2026-10-08T12:00:00Z',weekly_top_1_upvotes=0,min_post_karma=0)])
        update=calls[-1]
        self.assertNotIn('hot_1_weekly',update[0]); self.assertIn('min_post_karma',update[0]); self.assertEqual(update[1][0],0)
    def test_repair_uses_valid_saved_sources_without_replacing_existing_values(self):
        matrix=[['Subreddit','Hot 1 (Weekly)','Hot 2-5 Avg (Weekly)','Hot 6-10 Avg (Weekly)','Sync Status'],['Example','500','0','','success'],['Archived','0','0','0','archived']]
        history=[['Subreddit','Scraped At UTC','Hot 1','Hot 2-5 Avg','Hot 6-10 Avg'],['example','2026-06-01T12:00:00Z','20','30','']]
        baselines=[HEADERS,['example','Hot 6-10 Avg (Weekly)','2026-05-01T00:00:00Z','2026-05-08T00:00:00Z','2026-06-01T00:00:00Z','10','6','["a","b","c","d","e","f"]']]
        plan=restore_plan(matrix,history,baselines,parse_utc('2026-10-08T12:00:00Z'))
        self.assertEqual([(p['range'],p['after']) for p in plan],[('C2',30),('D2',10)])
        baselines[1][7]='["a"]'
        self.assertEqual(len(restore_plan(matrix,history,baselines,parse_utc('2026-10-08T12:00:00Z'))),1)

if __name__=='__main__': unittest.main()
