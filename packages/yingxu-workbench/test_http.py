"""真实 HTTP + FFmpeg 集成验证；所有数据写入临时目录。"""
import json, os, socket, subprocess, tempfile, time, unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

class HttpFlow(unittest.TestCase):
    def test_upload_dedup_analysis_range_and_isolation(self):
        with tempfile.TemporaryDirectory() as temp:
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            env={**os.environ,'PORT':str(port),'YINGXU_DATA':temp};env.pop('YINGXU_ANALYSIS_URL',None);env.pop('YINGXU_DORIS_URL',None)
            proc=subprocess.Popen(['python3',str(Path(__file__).with_name('server.py'))],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            base=f'http://127.0.0.1:{port}'
            def request(path,data=None):
                raw=json.dumps(data).encode() if data is not None else None
                with urlopen(Request(base+path,data=raw,headers={'Content-Type':'application/json'}),timeout=10) as r:return json.load(r)
            try:
                for _ in range(100):
                    try: request('/api/health');break
                    except OSError:time.sleep(.05)
                video=Path(temp)/'test.mp4'
                subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=160x240:d=1','-c:v','libx264','-pix_fmt','yuv420p',str(video)],check=True,timeout=30)
                batch=request('/api/batches',{'product':'mellow-ios','creator':'QA'})
                path='/api/upload?product=mellow-ios&batch='+batch['id']+'&name=test.mp4'
                def upload():
                    with urlopen(Request(base+path,data=video.read_bytes()),timeout=10) as r:return json.load(r)
                a=upload();self.assertEqual(upload()['status'],'duplicate')
                request('/api/seal',dict(product='mellow-ios',id=batch['id']))
                for _ in range(200):
                    s=request('/api/state?product=mellow-ios');row=s['assets'][0]
                    if row['analysis_status'] not in ('queued','running'):break
                    time.sleep(.05)
                self.assertEqual(row['analysis_status'],'pending');self.assertEqual(row['duration'],1);self.assertTrue(row.get('analysis_id'));self.assertIn('尚未配置',row['analysis_error'])
                with urlopen(base+'/covers/'+a['id']+'.jpg') as r:self.assertGreater(len(r.read()),100)
                with urlopen(Request(base+'/media/'+a['id'],headers={'Range':'bytes=0-99'})) as r:self.assertEqual(r.status,206);self.assertEqual(len(r.read()),100)
                self.assertEqual(request('/api/state?product=live')['assets'],[])
                with self.assertRaises(HTTPError) as err:urlopen(Request(base+'/api/scripts',data=b'{"name":"CSRF"}',headers={'Origin':'https://example.com'}))
                self.assertEqual(err.exception.code,403)
                with self.assertRaises(HTTPError):request('/api/upload?product=mellow-ios&batch='+batch['id']+'&name=x.mp4',{'bad':'sealed'})
                proc.terminate();proc.wait(timeout=10)
                proc=subprocess.Popen(['python3',str(Path(__file__).with_name('server.py'))],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                for _ in range(100):
                    try: restored=request('/api/state?product=mellow-ios');break
                    except OSError:time.sleep(.05)
                self.assertEqual(restored['assets'][0]['id'],a['id'])
            finally:proc.terminate();proc.wait(timeout=10)
if __name__=='__main__':unittest.main()
