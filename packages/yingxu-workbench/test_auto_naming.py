"""使用显式测试适配器验证流水线，不测试模型识别准确率。"""
import base64,json,os,subprocess,tempfile,threading,time,unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
import test_v6
class AutomaticNaming(unittest.TestCase):
    def test_audio_payload_auto_name_and_download(self):
        captured=[];v6=test_v6.V6Tests().fixture();v6['story_segments']=[dict(start=0,end=1)];v6['audio_review']['segments']=[dict(start=.1,end=.8,text='Synthetic test audio')]
        for e in v6['evidence'].values():e['at']=.2
        class Adapter(BaseHTTPRequestHandler):
            def do_POST(self):
                captured.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                raw=json.dumps({'summary':'测试适配器返回，不是真实识别','tags':[],'v6':v6}).encode();self.send_response(200);self.end_headers();self.wfile.write(raw)
            def log_message(self,*args):pass
        adapter=ThreadingHTTPServer(('127.0.0.1',0),Adapter);thread=threading.Thread(target=adapter.serve_forever,daemon=True);thread.start()
        try:
            import socket
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            with tempfile.TemporaryDirectory() as temp:
                video=Path(temp)/'test.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=160x240:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(video)],check=True)
                proc=subprocess.Popen(['python3',str(Path(__file__).with_name('server.py'))],env={**os.environ,'PORT':str(port),'YINGXU_DATA':temp,'YINGXU_ANALYSIS_URL':f'http://127.0.0.1:{adapter.server_port}'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                def req(path,data=None):
                    with urlopen(Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(data).encode() if data is not None else None),timeout=10) as r:return json.load(r)
                try:
                    for _ in range(100):
                        try:req('/api/health');break
                        except OSError:time.sleep(.05)
                    batch=req('/api/batches',{'product':'live'})
                    with urlopen(Request(f'http://127.0.0.1:{port}/api/upload?batch='+batch['id']+'&name=Mellow_1026_FB_XY_ZX_EN.mp4',data=video.read_bytes())) as r:a=json.load(r)
                    req('/api/seal',{'id':batch['id']})
                    for _ in range(200):
                        asset=req('/api/state')['assets'][0]
                        if asset['analysis_status'] not in ('running','queued'):break
                        time.sleep(.05)
                    self.assertEqual(asset['v6']['status'],'ready',asset.get('v6'));self.assertIn('_V6.mp4',asset['name']);self.assertEqual(asset['original_name'],'Mellow_1026_FB_XY_ZX_EN.mp4')
                    self.assertTrue(captured[0]['has_audio']);self.assertTrue(base64.b64decode(captured[0]['audio_wav_base64']).startswith(b'RIFF'));self.assertEqual(len(captured[0]['v6_dictionary']),15)
                    with urlopen(f'http://127.0.0.1:{port}/download/'+a['id']) as r:self.assertIn('V6.mp4',r.headers['Content-Disposition']);self.assertEqual(r.read(),video.read_bytes())
                finally:proc.terminate();proc.wait(timeout=10)
        finally:adapter.shutdown();adapter.server_close()
if __name__=='__main__':unittest.main()
