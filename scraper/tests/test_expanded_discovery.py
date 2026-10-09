import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from scraper.subreddit_maintenance import Maintenance, related_community_names
from scraper.tests.test_subreddit_maintenance import NOW

ENV={'DISCOVERY_RELATED_SEEDS_PER_DAY':'1','DISCOVERY_QUERIES_PER_DAY':'6','DISCOVERY_SEARCH_LIMIT':'75','DISCOVERY_MAX_CANDIDATE_CHECKS':'120','DISCOVERY_MIN_TOP1_UPVOTES':'400'}

def candidate(name, score=400, **kwargs):
    data=dict(display_name=name,_fetch=Mock(),over18=True,subreddit_type='public',subscribers=120000,title='Women',public_description='',description='',widgets=SimpleNamespace(sidebar=[]),new=lambda **kw:[SimpleNamespace(created_utc=NOW.timestamp(),removed_by_category=None)],top=lambda **kw:[SimpleNamespace(score=score,removed_by_category=None)])
    data.update(kwargs);return SimpleNamespace(**data)

class Widget(list):
    kind='community-list'

class ExpandedDiscoveryTests(unittest.TestCase):
    def worker(self, search, subs=None, *, apply=False):
        worker=Maintenance(None,None,None,apply=apply)
        worker.table=Mock(return_value=([],{'niche':0,'sync status':1},{'seed':[(2,['general, fitness, glamour, lingerie, cosplay, alt','success'])],'archived':[(3,['general','archived'])]}))
        worker.sql=Mock(side_effect=lambda statement, params=():[{'last_discovery_at':None,'discovery_cursor':0}] if 'SELECT * FROM subreddit_maintenance_control' in statement else [{'subreddit_name':'blocked'}] if 'SELECT subreddit_name FROM master_subreddits' in statement else [])
        subs=subs or {}
        worker.analyzer=SimpleNamespace(_call=lambda fn,label:fn(),reddit=SimpleNamespace(subreddits=SimpleNamespace(search=search),subreddit=lambda name:subs[name]))
        return worker

    def test_explicit_links_only_and_case_insensitive_dedup(self):
        self.assertEqual(related_community_names('Plain fiction, /r/Fitness and https://www.reddit.com/r/fitness/ + r/ALT_style, r/a r/'+'x'*22),['alt_style','fitness'])

    def test_defaults_expand_six_searches_and_add_sidebar_and_related_widgets(self):
        dup=candidate('duplicate'); linked=candidate('linked'); widget=candidate('widget'); sfw=candidate('sfw',over18=False);low=candidate('low',score=399)
        seed=candidate('seed',description='r/linked /r/duplicate /r/blocked /r/sfw /r/low',widgets=SimpleNamespace(sidebar=[Widget([widget,dup])]))
        search=Mock(return_value=[dup]);worker=self.worker(search,{'seed':seed,'linked':linked,'duplicate':dup,'sfw':sfw,'low':low})
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',ENV):worker.discover(25)
        self.assertEqual(search.call_count,6);self.assertTrue(all(c.kwargs['limit']==75 for c in search.call_args_list))
        self.assertEqual({m['name'] for m in worker.report['discovered']},{'duplicate','linked','widget'})
        self.assertEqual({m['source'] for m in worker.report['discovered']},{'niche_search','sidebar_link','related_widget'})
        self.assertEqual(dup._fetch.call_count,1);self.assertEqual(worker.report['discovery_related_seeds'],['seed']);self.assertFalse(worker.report['errors'])
        self.assertEqual(next(m for m in worker.report['discovered'] if m['name']=='linked')['query'],'')
        self.assertFalse(any(c.args[0].startswith(('INSERT','UPDATE')) for c in worker.sql.call_args_list))

    def test_unique_candidate_budget_bounds_external_checks(self):
        items=[candidate('sample_'+str(i)) for i in range(10)];worker=self.worker(Mock(return_value=items))
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',{**ENV,'DISCOVERY_RELATED_SEEDS_PER_DAY':'0','DISCOVERY_MAX_CANDIDATE_CHECKS':'2'}):worker.discover(25)
        self.assertEqual(len(worker.report['discovered']),2);self.assertEqual(sum(x._fetch.call_count for x in items),2)

    def test_daily_queue_limit_25_and_dedup_across_sources(self):
        items=[candidate('sample_'+str(i)) for i in range(40)];worker=self.worker(Mock(return_value=items))
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',{**ENV,'DISCOVERY_RELATED_SEEDS_PER_DAY':'0'}):worker.discover(25)
        self.assertEqual(len(worker.report['discovered']),25);self.assertEqual(sum(x._fetch.call_count for x in items),25)

    def test_all_failed_sources_do_not_consume_daily_discovery(self):
        worker=self.worker(Mock(side_effect=RuntimeError('offline')),apply=True)
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',{**ENV,'DISCOVERY_RELATED_SEEDS_PER_DAY':'0'}):worker.discover(25)
        self.assertEqual(worker.report['discovery_successful_sources'],0)
        self.assertFalse(any(c.args[0].startswith('UPDATE') for c in worker.sql.call_args_list));self.assertEqual(len(worker.report['errors']),6)

    def test_source_failure_does_not_block_other_sources(self):
        sub=candidate('linked');seed=candidate('seed',description='r/linked')
        worker=self.worker(Mock(side_effect=RuntimeError('search offline')),{'seed':seed,'linked':sub})
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',ENV):worker.discover(25)
        self.assertEqual([m['name'] for m in worker.report['discovered']],['linked'])

    def test_removed_top_post_does_not_qualify(self):
        sub=candidate('sample',top=lambda **kw:[SimpleNamespace(score=2000,removed_by_category='moderator')]);worker=self.worker(Mock(return_value=[sub]))
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',{**ENV,'DISCOVERY_RELATED_SEEDS_PER_DAY':'0'}):worker.discover(25)
        self.assertEqual(worker.report['discovered'],[])



class WidgetScopeTests(unittest.TestCase):
    worker = ExpandedDiscoveryTests.worker
    def test_missing_widget_scope_leaves_sidebar_working_and_skips_remaining_widget_calls(self):
        class InsufficientScope(Exception): pass
        class Widgets:
            @property
            def sidebar(self): raise InsufficientScope()
        a=candidate('seed',description='r/linked',widgets=Widgets());b=candidate('secondseed',description='r/secondlinked',widgets=Widgets())
        worker=self.worker(Mock(return_value=[]),{'seed':a,'secondseed':b,'linked':candidate('linked'),'secondlinked':candidate('secondlinked')})
        worker.table=Mock(return_value=([],{'niche':0,'sync status':1},{'seed':[(2,['general','success'])],'secondseed':[(3,['general','success'])]}))
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',{**ENV,'DISCOVERY_RELATED_SEEDS_PER_DAY':'2'}):worker.discover(25)
        self.assertEqual({m['name'] for m in worker.report['discovered']},{'linked','secondlinked'})
        self.assertEqual(worker.report['discovery_widgets_status'],'unavailable_scope');self.assertEqual(len(worker.report['discovery_warnings']),1);self.assertFalse(worker.report['errors'])




class UnavailableDiscoveryTests(unittest.TestCase):
    worker = ExpandedDiscoveryTests.worker
    def test_private_or_missing_candidate_is_skipped_not_published_or_archived(self):
        class Forbidden(Exception):
            response=SimpleNamespace(status_code=403)
        sub=candidate('private',_fetch=Mock(side_effect=Forbidden()))
        worker=self.worker(Mock(return_value=[sub]))
        with patch('scraper.subreddit_maintenance.utc_now',return_value=NOW),patch.dict('os.environ',{**ENV,'DISCOVERY_RELATED_SEEDS_PER_DAY':'0'}):worker.discover(25)
        self.assertEqual(worker.report['discovered'],[]);self.assertFalse(worker.report['errors']);self.assertEqual(worker.report['discovery_skipped'],[{'name':'private','reason':'unavailable','http_status':403}])

if __name__=='__main__':unittest.main()
