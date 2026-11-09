import copy,json,unittest
import naming_v6 as v
from pathlib import Path
class V6Tests(unittest.TestCase):
    def fixture(self):
        e=json.loads((Path(__file__).parent/'v6/references/example.json').read_text());tags=e.pop('tags');reasons=e.pop('na_reasons')
        return dict(metadata=e,tags=tags,na_reasons=reasons,story_segments=[dict(start=0,end=18)],visual_reviewed=True,subtitle_reviewed=True,audio_review=dict(status='reviewed',note='核对角色对白，与字幕一致',segments=[dict(start=1,end=2,text='Hello')]),evidence={code:dict(source='subtitle',at=2,observation='测试主体证据') for values in tags.values() for code in values})
    def test_dictionary_and_bilingual(self):
        self.assertEqual(v.validator.audit()['tags'],200);self.assertEqual(len(v.GROUPS),15)
        self.assertTrue(all(t['canonical'] and t['label'] for g in v.GROUPS for t in g['tags']))
    def test_ready_has_24_fields_and_correct_original_date(self):
        d=v.evaluate(self.fixture(),True,20);self.assertEqual(d['issues'],[]);self.assertEqual(d['status'],'ready');self.assertEqual(len(Path(d['proposed_name']).stem.split('_')),24);self.assertIn('_1026_',d['proposed_name'])
    def test_audio_required_and_outro_excluded(self):
        d=self.fixture();d['audio_review']['status']='pending';d['evidence']['sm']['at']=19
        r=v.evaluate(d,True,20);self.assertEqual(r['status'],'pending');self.assertTrue(any('音轨' in x for x in r['issues']));self.assertTrue(any('sm' in x for x in r['issues']))
    def test_na_reason_and_wrong_group(self):
        d=self.fixture();d['tags']['物种']=['na'];self.assertEqual(v.evaluate(d)['status'],'pending');d['na_reasons']['物种']='检查主体后物种识别不出';self.assertEqual(v.evaluate(d)['status'],'ready');d['tags']['物种']=['j7'];self.assertEqual(v.evaluate(d)['status'],'pending')
    def test_metadata_parser_does_not_migrate_legacy_tags(self):
        d=v.initial('Mellow-1010-FB-XY-XY-TMM-EN (3).mp4',3);self.assertEqual(d['metadata']['producer'],'XY');self.assertEqual(d['metadata']['date'],'1010');self.assertTrue(all(x==['unk'] for x in d['tags'].values()))
    def test_preserve_original_and_no_collision(self):
        a=dict(id='a',name='original.mp4',duration=20,has_audio=True);v.apply(a,self.fixture(),[a],manual=True);self.assertEqual(a['original_name'],'original.mp4');self.assertEqual(a['v6']['status'],'ready')
        b=dict(id='b',name='another.mp4',duration=20,has_audio=True);v.apply(b,self.fixture(),[a,b],manual=True);self.assertEqual(b['v6']['status'],'pending');self.assertEqual(b['name'],'another.mp4')
    def test_no_audio_distinct_from_unreviewed(self):
        d=self.fixture();d['audio_review']=dict(status='no_audio',segments=[],note='无音轨');self.assertEqual(v.evaluate(d,False)['status'],'ready');self.assertEqual(v.evaluate(d,True)['status'],'pending')
if __name__=='__main__':unittest.main()
