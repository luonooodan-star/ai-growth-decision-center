#!/usr/bin/env python3
"""映序：本地独立素材工作台。Python 3.10+，SQLite，FFmpeg。"""
import base64, copy, hashlib, json, mimetypes, os, re, sqlite3, subprocess, threading, uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone, date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('YINGXU_DATA', ROOT / 'data')).resolve()
LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=2)
PRODUCTS = ('demo', 'live', 'mellow-ios')
TAGS = {'角色职业':['总裁','医生','运动员','大学生','黑帮首领','调酒师'], '角色身份':['吸血鬼','狼人','恶魔','不朽者'], '当前关系':['恋人关系','暧昧关系','前任关系','陌生人关系','配偶关系','上下级关系'], '关系与爱情套路':['命定伴侣','欢喜冤家','破镜重圆','三角关系','契约关系','职场恋爱'], '剧情触发点与事件':['主动关心','重逢','选择困境','意外告白','身份揭露','救援保护'], '核心陪伴需求':['恋爱体验','倾诉安慰','日常陪伴','角色幻想','剧情探索'], '角色人设':['保护型','调情型','强势主导型','外硬内软型'], '画风':['写实风格','二次元','3D风格'], '显著细节':['眼镜','纹身','穿孔饰品'], '发色':['黑发','金发','棕发']}

def now(): return datetime.now(timezone.utc).isoformat()
def today(): return datetime.now(timezone(timedelta(hours=8))).date().isoformat()
def uid(prefix): return prefix + uuid.uuid4().hex[:16]
def require(ok, message, status=400):
    if not ok: raise Problem(message, status)
class Problem(Exception):
    def __init__(self, message, status=400): super().__init__(message); self.status=status

def blank():
    return dict(assets=[], scripts=[], analyses=[], audit=[], facts=[], cohorts=[], batches=[], tags=copy.deepcopy(TAGS), settings={'quality_rule':{}}, integrations={'doris':{'status':'unconfigured'}}, candidates={'groups':[], 'revision':0, 'status':'draft'})
def init():
    DATA.mkdir(parents=True, exist_ok=True)
    for name in ('media','covers','frames','tmp'): (DATA/name).mkdir(exist_ok=True)
    with sqlite3.connect(DATA/'workspace.sqlite3') as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE IF NOT EXISTS workspace (product TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        for p in PRODUCTS: db.execute('INSERT OR IGNORE INTO workspace VALUES (?,?)',(p,json.dumps(blank(),ensure_ascii=False)))
    with LOCK:
        for p in PRODUCTS:
            s=load(p)
            if s['integrations']['doris'].get('status')=='syncing': s['integrations']['doris'].update(status='failed',error='服务重启中断同步，请重试')
            for a in s['assets']:
                if a['analysis_status'] in ('running','queued'):
                    a['analysis_status']='queued'; POOL.submit(analyze,p,a['id'])
            save(p,s)
def load(p):
    require(p in PRODUCTS,'未知产品')
    with sqlite3.connect(DATA/'workspace.sqlite3') as db:
        return json.loads(db.execute('SELECT payload FROM workspace WHERE product=?',(p,)).fetchone()[0])
def save(p,s):
    with sqlite3.connect(DATA/'workspace.sqlite3') as db:
        db.execute('UPDATE workspace SET payload=? WHERE product=?',(json.dumps(s,ensure_ascii=False,allow_nan=False),p))
def find(s,key,id):
    obj=next((x for x in s[key] if x['id']==id),None)
    require(obj is not None,'记录不存在',404); return obj

def audit(s,before,after,action,reason):
    s['audit'].append(dict(id=uid('log_'),at=now(),actor='本地管理员',action=action,reason=reason,before=copy.deepcopy(before),after=copy.deepcopy(after)))
def classify(a):
    return '成片裂变' if a.get('source_type')=='asset' else '脚本裂变' if a.get('source_type')=='script' else '新脚本首批' if a.get('script_id') else '待分类'
def external(url,payload,token=''):
    req=Request(url,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    with urlopen(req,timeout=180) as r:
        data=r.read(20*1024*1024+1)
        require(len(data)<=20*1024*1024,'集成响应超过限制')
        return json.loads(data)
def run(args):
    return subprocess.run(args,check=True,capture_output=True,timeout=90).stdout

def analyze(p,id):
    with LOCK:
        s=load(p); a=find(s,'assets',id)
        if a['analysis_status']!='queued': return
        a['analysis_status']='running'; save(p,s); path=DATA/'media'/a['file']
    try:
        meta=json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
        video=next((x for x in meta['streams'] if x['codec_type']=='video'),None)
        require(video is not None,'文件不包含视频轨道')
        duration=float(meta['format'].get('duration',0)); aid=uid('analysis_'); folder=DATA/'frames'/aid; folder.mkdir()
        frames=[]
        for i in range(5):
            at=round(max(0,duration-.1)*i/5,2); name=f'{i}.jpg'
            run(['ffmpeg','-v','error','-ss',str(at),'-i',str(path),'-frames:v','1','-vf','scale=640:-2','-y',str(folder/name)])
            frames.append({'at':at,'file':name})
        (DATA/'covers'/f'{id}.jpg').write_bytes((folder/'0.jpg').read_bytes())
        endpoint=os.environ.get('YINGXU_ANALYSIS_URL')
        result=None
        if endpoint:
            result=external(endpoint,{'asset_id':id,'name':a['name'],'duration':duration,'taxonomy':TAGS,'frames':[dict(at=f['at'],jpeg_base64=base64.b64encode((folder/f['file']).read_bytes()).decode()) for f in frames]},os.environ.get('YINGXU_ANALYSIS_TOKEN',''))
            require(isinstance(result,dict) and isinstance(result.get('summary'),str),'分析服务返回格式错误：缺少 summary')
            require(isinstance(result.get('tags',[]),list),'分析服务 tags 必须是数组')
        with LOCK:
            s=load(p); a=find(s,'assets',id)
            a.update(duration=round(duration,2),width=video.get('width'),height=video.get('height'),analysis_error='')
            report=dict(id=aid,created_at=now(),provider='外部视觉分析适配器' if result else 'FFmpeg 本地采样（无 AI 推理）',prompt_version='yingxu-v1',tags=[],script_candidates=[],limitations=['只采样视频画面，未分析音轨'],frames=frames,sufficient_visual_evidence=bool(result),script_title='',summary='已完成视频元数据读取与关键帧采样。配置视觉分析服务后可生成剧情和标签建议。')
            if result:
                report.update({k:result[k] for k in ('summary','script_title','creative_analysis') if k in result})
                report['tags']=[t for t in result.get('tags',[]) if t in sum(TAGS.values(),[])]
            else: report['limitations'].append('未配置 YINGXU_ANALYSIS_URL；未生成剧情或标签结论')
            s['analyses'].append(report); a['analysis_id']=aid
            a['analysis_status']='completed' if result else 'pending'
            if not result: a['analysis_error']='封面与关键帧已生成；内容分析服务尚未配置，可先人工复核。'
            if not a.get('manual_locked'): a['state']='待复核'
            save(p,s)
    except Exception as e:
        with LOCK:
            s=load(p); a=find(s,'assets',id); a['analysis_status']='failed'; a['analysis_error']=('未找到 FFmpeg / FFprobe，请安装后重试' if isinstance(e,FileNotFoundError) else str(e)[:400]);
            if not a.get('manual_locked'): a['state']='分析失败'
            save(p,s)

def recovery(s):
    result={}; seen=set(); owners={}
    def ident(d,c,k,i,n): return (d,c,k,str(i or ''),n or '')
    for f in s['facts']:
        if f['bucket']=='single': owners.setdefault(ident(f['date'],f['channel'],f['country'],f['creative_id'],f['creative_name']),set()).add(f['asset_id'])
    cutoff=date.fromisoformat(today())-timedelta(days=1)
    for c in s['cohorts']:
        if c.get('metric_id')!='revenue' or c.get('cohort_unit')!='D' or c.get('match_status')!='matched' or str(c.get('observation_complete')).lower() not in ('1','true'): continue
        key=ident(c['install_date'],c['media_source'],c['country_code'],c['creative_id'],c['creative_name']); ids=owners.get(key,set()); age=int(c['cohort_index'])
        unique=(key,c.get('campaign_id'),c.get('adgroup_id'),age)
        if len(ids)!=1 or unique in seen or date.fromisoformat(c['install_date'])+timedelta(days=age)>cutoff or c.get('cumulative_metric_value') is None or not c.get('cohort_spend',0)>0: continue
        seen.add(unique); v=result.setdefault(next(iter(ids)),{}).setdefault(age,dict(spend=0,revenue=0)); v['spend']+=c['cohort_spend']; v['revenue']+=c['cumulative_metric_value']
    return result

def business_day(stamp): return datetime.fromisoformat(stamp).astimezone(timezone(timedelta(hours=8))).date().isoformat()

def state(p,day):
    s=load(p); day=day or today(); date.fromisoformat(day)
    rows=[a for a in s['assets'] if datetime.fromisoformat(a['uploaded_at']).astimezone(timezone(timedelta(hours=8))).date().isoformat()==day]
    s['summary']=dict(total=len(rows),new_scripts=sum(1 for x in s['scripts'] if min([business_day(a['uploaded_at']) for a in s['assets'] if a['script_id']==x['id']] or [''])==day),quality=sum(a['quality']=='值得裂变' for a in rows),complete=sum(a['analysis_status']=='completed' for a in rows),duplicates=sum(b.get('duplicates',0) for b in s['batches'] if business_day(b['created_at'])==day),failed=sum(b.get('failed',0) for b in s['batches'] if business_day(b['created_at'])==day),classes={c:sum(a['classification']==c for a in rows) for c in ('新脚本首批','脚本裂变','成片裂变','待分类')})
    s['recoveries']=recovery(s); s['recovery_as_of']=(date.fromisoformat(today())-timedelta(days=1)).isoformat()
    fs=[f for f in s['facts'] if f['bucket']=='single']; spend=sum(f['spend'] for f in fs); installs=sum(f.get('installs') or 0 for f in fs)
    complete=[f for f in fs if f.get('d0_complete') and f.get('d0_payers') is not None and f.get('installs') is not None]
    denominator=sum(f['installs'] for f in complete)
    s['metrics']=dict(spend=spend if fs else None,installs=installs if fs else None,cpi=spend/installs if installs else None,d0_rate=sum(f['d0_payers'] for f in complete)/denominator if denominator else None)
    s['capabilities']={'analysis':bool(os.environ.get('YINGXU_ANALYSIS_URL')),'doris':bool(os.environ.get('YINGXU_DORIS_URL')),'ffmpeg':__import__('shutil').which('ffmpeg') is not None}
    return s

def import_facts(s,body):
    rows=body.get('facts',[]); cohorts=body.get('cohorts',[])
    require(isinstance(rows,list) and isinstance(cohorts,list) and len(rows)<=50000,'facts/cohorts 必须为数组，最多 50000 行')
    validated=[]
    for f in rows:
        require(isinstance(f,dict),'投放行必须是对象')
        for key in ('date','channel','country','creative_id'): require(isinstance(f.get(key),str) and bool(f[key]),'缺少字段 '+key)
        date.fromisoformat(f['date']); require(isinstance(f.get('spend'),(int,float)) and f['spend']>=0,'spend 必须是非负数')
        row={k:f.get(k) for k in ('date','channel','country','creative_id','creative_name','spend','impressions','clicks','installs','d0_revenue','d7_revenue','d30_revenue','d0_payers','d0_complete','d7_complete','d30_complete')}
        row['creative_name']=str(row['creative_name'] or '')
        for k in ('impressions','clicks','installs','d0_revenue','d7_revenue','d30_revenue','d0_payers'):
            require(row[k] is None or isinstance(row[k],(float,int)) and row[k]>=0,k+' 必须是非负数或 null')
        for k in ('d0_complete','d7_complete','d30_complete'):
            require(row[k] is None or isinstance(row[k],bool),k+' 必须是布尔值')
        dims=f.get('source_dimensions',{}); require(isinstance(dims,dict),'source_dimensions 必须为对象'); row['source_dimensions']=dims
        identity=[row[k] for k in ('date','channel','country','creative_id','creative_name')]+[dims.get('campaign_id'),dims.get('adgroup_id')]
        row['id']='fact_'+hashlib.sha256(json.dumps(identity,ensure_ascii=False).encode()).hexdigest()[:24]
        old=next((v for v in s['facts'] if v['id']==row['id']),{})
        row.update(bucket=old.get('bucket','unmatched'),asset_id=old.get('asset_id','')); validated.append(row)
    for c in cohorts:
        require(isinstance(c,dict),'cohort 必须是对象')
        for k in ('install_date','media_source','country_code','creative_id','creative_name','cohort_index','cohort_spend','metric_id','cohort_unit','match_status'): require(k in c,'cohort 缺少 '+k)
        date.fromisoformat(c['install_date']); require(isinstance(c['cohort_index'],int) and 0<=c['cohort_index']<=365,'cohort_index 无效')
        require(isinstance(c['cohort_spend'],(float,int)) and c['cohort_spend']>=0,'cohort_spend 无效')
        require(c.get('cumulative_metric_value') is None or isinstance(c['cumulative_metric_value'],(float,int)) and c['cumulative_metric_value']>=0,'cohort 收入无效')
    facts={r['id']:r for r in s['facts']}; facts.update({r['id']:r for r in validated}); s['facts']=list(facts.values())
    def ck(c): return json.dumps([c.get(k) for k in ('install_date','media_source','country_code','creative_id','creative_name','campaign_id','adgroup_id','cohort_index','metric_id','cohort_unit')])
    cs={ck(c):c for c in s['cohorts']};cs.update({ck(c):c for c in cohorts});s['cohorts']=list(cs.values())
    return {'imported':len(validated),'total':len(s['facts'])}

def sync_doris(p,start,end):
    try:
        data=external(os.environ['YINGXU_DORIS_URL'],dict(product=p,start=start,end=end),os.environ.get('YINGXU_DORIS_TOKEN',''))
        with LOCK:
            s=load(p); import_facts(s,data); s['integrations']['doris']=dict(status='ready',start=start,end=end,updated_at=now(),username='只读适配器',role='配置授权',app_id=p,reconciled=False);save(p,s)
    except Exception as e:
        with LOCK:
            s=load(p);s['integrations']['doris'].update(status='failed',error=str(e)[:400]);save(p,s)

def candidates(s):
    d=copy.deepcopy(s['candidates'])
    for g in d['groups']:
        for m in g['members']:
            a=find(s,'assets',m['asset_id']); r=next((r for r in s['analyses'] if r['id']==a.get('analysis_id')),{})
            m['asset']=dict(name=a['name'],title=r.get('script_title') or a['name'],summary=r.get('summary',''),analysis_id=r.get('id',''),frames=r.get('frames',[]),timeline=r.get('creative_analysis',{}).get('timeline',[]),conclusion=r.get('summary',''))
    return d

def post(path,b,p):
    s=load(p)
    if path=='/api/scripts':
        require(isinstance(b.get('name'),str) and 0<len(b['name'].strip())<=100,'脚本名称需为 1–100 字')
        result=dict(id=uid('S'),name=b['name'].strip(),summary=str(b.get('summary','')),version=1,created_at=now());s['scripts'].append(result)
    elif path=='/api/batches':
        result=dict(id=uid('batch_'),name=str(b.get('name') or '批量上传'),creator=str(b.get('creator','')),created_at=now(),sealed=False,duplicates=0,failed=0);s['batches'].append(result)
    elif path=='/api/seal':
        batch=find(s,'batches',b.get('id'));batch['sealed']=True;result={'ok':True}
        for a in s['assets']:
            if a['batch']==batch['id'] and a['analysis_status']=='pending': a['analysis_status']='queued';POOL.submit(analyze,p,a['id'])
    elif path=='/api/retry':
        a=find(s,'assets',b.get('id'));require(a.get('file'),'没有视频文件');require(a['analysis_status'] not in ('running','queued'),'分析已经在队列中',409);a['analysis_status']='queued';a['analysis_error']='';POOL.submit(analyze,p,a['id']);result={'ok':True}
    elif path=='/api/review':
        a=find(s,'assets',b.get('id'));require(b.get('revision')==a['revision'],'记录已更新，请刷新后重试',409);require(str(b.get('reason','')).strip(),'必须填写调整依据')
        before=copy.deepcopy(a); st=b.get('source_type','');si=b.get('source_id','');script=b.get('script_id','')
        require(st in ('','asset','script'),'来源类型无效')
        if script: find(s,'scripts',script)
        if st:
            source=find(s,'assets' if st=='asset' else 'scripts',si)
            if st=='asset': require(source['id']!=a['id'] and source['uploaded_at']<a['uploaded_at'] and source['batch']!=a['batch'],'来源成片必须来自更早批次')
        else: si=''
        tags=b.get('tags',[]);require(isinstance(tags,list) and all(t in sum(s['tags'].values(),[]) for t in tags),'标签不在词表中')
        a.update(script_id=script,source_type=st,source_id=si,tags=list(dict.fromkeys(tags)),tags_confirmed=True,reason=b['reason'],state='完成',manual_locked=True,revision=a['revision']+1)
        if (st,si)!=(before['source_type'],before['source_id']): a['quality']='规则未配置'
        a['classification']=classify(a);audit(s,before,a,'人工复核',b['reason']);result=a
    elif path=='/api/undo':
        log=find(s,'audit',b.get('id'));require(log['action'] in ('人工复核','撤销复核'),'该操作不可撤销');a=find(s,'assets',log['after']['id']);require(a['revision']==log['after']['revision'],'只能撤销最新版本',409)
        before=copy.deepcopy(a)
        for k in ('script_id','source_type','source_id','tags','tags_confirmed','reason','state','manual_locked','classification','quality'): a[k]=log['before'].get(k)
        a['revision']+=1;audit(s,before,a,'撤销复核','撤销 '+log['id']);result=a
    elif path=='/api/settings':
        rule=b.get('quality_rule',{});require(isinstance(rule,dict),'规则无效')
        for k,v in rule.items():
            if k not in ('market','channel') and v!='': require(float(v)>=0,'规则数值不可为负')
        s['settings']['quality_rule']=rule;result=s['settings']
    elif path=='/api/facts/import': result=import_facts(s,b)
    elif path=='/api/mapping':
        f=find(s,'facts',b.get('id'));bucket=b.get('bucket');require(bucket in ('single','combination','unmatched'),'归属无效');require(str(b.get('reason','')).strip(),'必须填写映射依据')
        if bucket=='single': find(s,'assets',b.get('asset_id'))
        before=copy.deepcopy(f);f.update(bucket=bucket,asset_id=b.get('asset_id') if bucket=='single' else '',reason=b['reason']);audit(s,before,f,'素材映射',b['reason']);result=f
    elif path=='/api/doris/sync':
        require(os.environ.get('YINGXU_DORIS_URL'),'尚未配置 Doris 只读适配器。可先导入投放 JSON 数据。',503)
        start=b.get('start','');end=b.get('end','');require(date.fromisoformat(start)<=date.fromisoformat(end),'日期范围无效')
        require(s['integrations']['doris'].get('status')!='syncing','同步已在进行',409)
        s['integrations']['doris'].update(status='syncing',start=start,end=end);POOL.submit(sync_doris,p,start,end);result={'ok':True}
    elif path=='/api/script-candidates/generate':
        d=s['candidates']
        if d['status']=='confirmed':
            d=dict(groups=[],revision=d['revision'],status='draft');s['candidates']=d
        existing={m['asset_id'] for g in d['groups'] for m in g['members']}
        for a in s['assets']:
            if a['script_id'] or a['id'] in existing: continue
            r=next((r for r in s['analyses'] if r['id']==a.get('analysis_id')),{});d['groups'].append(dict(candidate_id=uid('C'),name=r.get('script_title') or a['name'],definition=r.get('summary',''),sequence='',boundary='待人工核对；默认独立组，不以文件名推断剧情相同',members=[dict(asset_id=a['id'],assessment='待复核',reviewed=False,basis='请查看视频和关键帧后确认',difference='尚未确认版本差异')]))
        d['revision']+=1;d['updated_at']=now();result=candidates(s)
    elif path in ('/api/script-candidates/save','/api/script-candidates/confirm'):
        d=s['candidates'];require(d['status']!='confirmed','候选已确认',409);require(b.get('revision')==d['revision'],'草稿版本冲突，请刷新页面',409)
        groups=b.get('groups');require(isinstance(groups,list) and len(groups)>0,'候选组不可为空');ids=set();gids=set()
        for g in groups:
            require(isinstance(g.get('name'),str) and g['name'].strip() and g.get('members'),'候选名称与成员不能为空');require(g.get('candidate_id') not in gids,'候选组 ID 重复');gids.add(g['candidate_id'])
            for m in g['members']:
                a=find(s,'assets',m['asset_id']);require(a['id'] not in ids,'素材不可出现在多个候选组');ids.add(a['id']);m.pop('asset',None)
                if path.endswith('/confirm'): require(m.get('reviewed') is True,'每条候选都必须人工确认');require(not a['script_id'],'素材已归组，请重新生成候选',409)
        d.update(groups=groups,revision=d['revision']+1,updated_at=now())
        if path.endswith('/confirm'):
            for g in groups:
                script=dict(id=uid('S'),name=g['name'],summary=g.get('definition',''),version=1,created_at=now());s['scripts'].append(script)
                for m in g['members']:
                    a=find(s,'assets',m['asset_id']);before=copy.deepcopy(a);a.update(script_id=script['id'],manual_locked=True,revision=a['revision']+1);a['classification']=classify(a);audit(s,before,a,'候选确认','人工确认脚本归组')
            d['status']='confirmed'
        result=candidates(s)
    else: raise Problem('接口不存在',404)
    save(p,s);return result

class Handler(BaseHTTPRequestHandler):
    server_version='Yingxu/1.0'
    def json(self,data,status=200):
        raw=json.dumps(data,ensure_ascii=False,allow_nan=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(raw)
    def handle_request(self,write=False):
        u=urlsplit(self.path);q={k:v[0] for k,v in parse_qs(u.query).items()};p=q.get('product','live')
        try:
            host=self.headers.get('Host','').split(':')[0]
            require(host in ('localhost','127.0.0.1','[::1]'),'仅允许本机访问',403)
            if write:
                origin=self.headers.get('Origin');require(not origin or urlsplit(origin).netloc==self.headers.get('Host'),'不允许跨站写入',403)
                if u.path=='/api/upload': return self.upload(q)
                n=int(self.headers.get('Content-Length','0'));require(0<n<=20*1024*1024,'JSON 请求体过大或为空',413)
                b=json.loads(self.rfile.read(n),parse_constant=lambda x: (_ for _ in ()).throw(ValueError('不接受 NaN/Infinity')));require(isinstance(b,dict),'请求体必须是对象');p=b.get('product',p)
                with LOCK: return self.json(post(u.path,b,p))
            with LOCK:
                if u.path=='/api/state': return self.json(state(p,q.get('date')))
                if u.path=='/api/analysis-status': return self.json({'assets':load(p)['assets']})
                if u.path=='/api/script-candidates': return self.json(candidates(load(p)))
                if u.path=='/api/health': return self.json({'ok':True})
                if u.path.startswith('/media/'):
                    aid=u.path.split('/')[-1];a=next((a for pr in PRODUCTS for a in load(pr)['assets'] if a['id']==aid),None);require(a and a['file'],'视频不存在',404);return self.file(DATA/'media'/a['file'])
            if u.path.startswith('/covers/') or u.path.startswith('/frames/'):
                target=(DATA/u.path.lstrip('/')).resolve();require(target.is_relative_to(DATA) and target.is_file(),'资源不存在',404);return self.file(target)
            target=(ROOT/'public'/u.path.lstrip('/')).resolve() if u.path!='/' else ROOT/'public/index.html'
            require(target.is_relative_to(ROOT/'public') and target.is_file(),'页面不存在',404);self.file(target)
        except (BrokenPipeError,ConnectionResetError): pass
        except Problem as e: self.json({'error':str(e)},e.status)
        except (ValueError,KeyError,TypeError) as e: self.json({'error':'数据格式无效：'+str(e)[:200]},400)
        except Exception as e:
            print(type(e).__name__,str(e)[:300],flush=True);self.json({'error':'服务内部错误，请查看本机日志'},500)
    def upload(self,q):
        p=q.get('product','live'); name=q.get('name','');require(Path(name).suffix.lower() in ('.mp4','.mov'),'仅支持 MP4 / MOV')
        n=int(self.headers.get('Content-Length',0));require(0<n<=500*1024*1024,'视频须小于 500 MB 且不能为空',413)
        with LOCK:
            s=load(p);b=find(s,'batches',q.get('batch'));require(not b['sealed'],'批次已封存',409);require(sum(a['batch']==b['id'] for a in s['assets'])<200,'单批最多 200 条')
        tmp=DATA/'tmp'/uid('upload_');digest=hashlib.sha256()
        try:
            with tmp.open('wb') as f:
                remaining=n
                while remaining:
                    chunk=self.rfile.read(min(1024*1024,remaining));require(chunk,'上传中断');f.write(chunk);digest.update(chunk);remaining-=len(chunk)
            with tmp.open('rb') as f: header=f.read(32)
            require(b'ftyp' in header or header[4:8] in (b'moov',b'mdat',b'wide',b'free'),'文件不是有效 MP4 / MOV 容器')
            with LOCK:
                s=load(p);b=find(s,'batches',q.get('batch'));require(not b['sealed'],'批次已封存',409);require(sum(a['batch']==b['id'] for a in s['assets'])<200,'单批最多 200 条')
                old=next((a for a in s['assets'] if a.get('sha256')==digest.hexdigest()),None)
                if old: b['duplicates']+=1;save(p,s);return self.json({'status':'duplicate','id':old['id']})
                id=uid('A');file=id+Path(name).suffix.lower();tmp.replace(DATA/'media'/file)
                a=dict(id=id,name=Path(name).name,file=file,sha256=digest.hexdigest(),size=n,uploaded_at=now(),batch=b['id'],creator=b['creator'],duration=0,language='未知',script_id='',source_type='',source_id='',tags=[],classification='待分类',state='等待批次提交',analysis_status='pending',analysis_error='',quality='规则未配置',variation='',reason='新上传，等待复核',revision=1,manual_locked=False)
                s['assets'].append(a);save(p,s);self.json({'status':'uploaded','id':id})
        finally: tmp.unlink(missing_ok=True)
    def file(self,path):
        size=path.stat().st_size;start=0;end=size-1;status=200
        if self.headers.get('Range'):
            m=re.fullmatch(r'bytes=(\d*)-(\d*)',self.headers['Range']);require(m and (m[1] or m[2]),'无效 Range',416)
            if m[1]: start=int(m[1]);end=min(int(m[2]) if m[2] else size-1,size-1)
            else: start=max(0,size-int(m[2]))
            require(0<=start<=end<size,'Range 超出范围',416);status=206
        self.send_response(status);self.send_header('Content-Type',mimetypes.guess_type(path)[0] or 'application/octet-stream');self.send_header('Content-Length',str(end-start+1));self.send_header('Accept-Ranges','bytes');self.send_header('X-Content-Type-Options','nosniff')
        if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.end_headers()
        if self.command=='HEAD':return
        with path.open('rb') as f:
            f.seek(start);left=end-start+1
            while left:
                chunk=f.read(min(left,1024*1024));self.wfile.write(chunk);left-=len(chunk)
    def do_GET(self): self.handle_request()
    def do_HEAD(self): self.handle_request()
    def do_POST(self): self.handle_request(True)

if __name__=='__main__':
    init();port=int(os.environ.get('PORT','8767'));print(f'映序工作台 http://127.0.0.1:{port}',flush=True)
    try:ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
    except KeyboardInterrupt:POOL.shutdown(wait=False,cancel_futures=True)
