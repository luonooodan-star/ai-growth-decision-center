import copy, importlib.util, json, os, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('workbench',Path(__file__).with_name('server.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();m.DATA=Path(self.tmp.name);m.init();self.p='live'
        s=m.load(self.p)
        for i in range(2):
            s['assets'].append(dict(id=f'A{i}',name=f'video{i}.mp4',file='',uploaded_at=f'2026-11-0{i+1}T12:00:00+00:00',batch=f'b{i}',creator='',duration=1,language='未知',script_id='',source_type='',source_id='',tags=[],classification='待分类',state='待复核',analysis_status='pending',quality='规则未配置',variation='',reason='',revision=1,manual_locked=False))
        m.save(self.p,s)
    def tearDown(self): self.tmp.cleanup()
    def post(self,path,b): return m.post('/api/'+path,b,self.p)
    def test_review_undo_and_conflict(self):
        script=self.post('scripts',{'name':'Test'})
        self.post('review',dict(id='A1',revision=1,script_id=script['id'],source_type='asset',source_id='A0',tags=['重逢'],reason='核对视频'))
        s=m.load(self.p);self.assertEqual(s['assets'][1]['classification'],'成片裂变')
        with self.assertRaises(m.Problem): self.post('review',dict(id='A1',revision=1,reason='过期'))
        self.post('undo',{'id':s['audit'][-1]['id']});self.assertEqual(m.load(self.p)['assets'][1]['classification'],'待分类')
        with self.assertRaises(m.Problem): self.post('review',dict(id='A0',revision=1,source_type='asset',source_id='A1',reason='未来来源'))
    def test_import_dedup_preserves_mapping_and_atomic_validation(self):
        fact=dict(date='2026-11-01',channel='Meta',country='US',creative_id='c1',creative_name='Video',spend=100,installs=10)
        self.post('facts/import',{'facts':[fact]});f=m.load(self.p)['facts'][0]
        self.post('mapping',dict(id=f['id'],bucket='single',asset_id='A0',reason='核对 ID'))
        self.post('facts/import',{'facts':[{**fact,'spend':150}]});s=m.load(self.p)
        self.assertEqual(len(s['facts']),1);self.assertEqual(s['facts'][0]['asset_id'],'A0');self.assertEqual(s['facts'][0]['spend'],150)
        with self.assertRaises(m.Problem):self.post('facts/import',{'facts':[fact,{**fact,'spend':-1}]})
        self.assertEqual(m.load(self.p)['facts'][0]['spend'],150)
    def test_candidate_requires_review_and_revision(self):
        d=self.post('script-candidates/generate',{});self.assertEqual(len(d['groups']),2)
        with self.assertRaises(m.Problem):self.post('script-candidates/confirm',d)
        for g in d['groups']:
            for member in g['members']: member['reviewed']=True
        out=self.post('script-candidates/confirm',d);self.assertEqual(out['status'],'confirmed');self.assertEqual(len(m.load(self.p)['scripts']),2)
        with self.assertRaises(m.Problem):self.post('script-candidates/confirm',d)
    def test_product_isolation(self):
        self.post('scripts',{'name':'Live script'});self.assertEqual(m.load('mellow-ios')['scripts'],[])
    def test_recovery_maturity_zero_and_dedup(self):
        f=dict(date='2026-01-01',channel='Meta',country='US',creative_id='c',creative_name='x',spend=100)
        c=dict(install_date='2026-01-01',media_source='Meta',country_code='US',creative_id='c',creative_name='x',cohort_index=7,cohort_spend=100,metric_id='revenue',cohort_unit='D',match_status='matched',observation_complete=True,cumulative_metric_value=0,campaign_id='cmp',adgroup_id='ag')
        self.post('facts/import',dict(facts=[f],cohorts=[c,c]));s=m.load(self.p);self.post('mapping',dict(id=s['facts'][0]['id'],bucket='single',asset_id='A0',reason='核实'))
        r=m.state(self.p,'2026-11-01')['recoveries']['A0'][7];self.assertEqual(r,dict(spend=100,revenue=0))
    def test_unconfigured_sync_is_not_success(self):
        old=os.environ.pop('YINGXU_DORIS_URL',None)
        try:
            with self.assertRaises(m.Problem) as caught:self.post('doris/sync',dict(start='2026-11-01',end='2026-11-02'))
            self.assertEqual(caught.exception.status,503)
        finally:
            if old:os.environ['YINGXU_DORIS_URL']=old
if __name__=='__main__': unittest.main()
