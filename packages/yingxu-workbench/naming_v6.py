"""V6 修订3：使用原版200码字典；正式名称必须有完整证据。"""
import copy, importlib.util, re
from pathlib import Path
ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location('v6_validator',ROOT/'v6/scripts/naming.py')
validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator);validator.audit()
DICTIONARY=validator.D
GROUP_EN=['Primary category','Character composition','User point of view','Audience and pairing','Relationship setup','Personality traits','Occupation and identity','Species','Emotional and relationship atmosphere','Themes and worldbuilding','Art form','Rendering style','Character aesthetics','Visual atmosphere','Appearance features']
GROUPS=[dict(g,english=en) for g,en in zip(DICTIONARY['groups'],GROUP_EN)]

FULL_EN={'sm':'Solo male','sf':'Solo female','dm':'Dual male','df':'Dual female','mf':'Male and female','mm':'Multiple males','ff':'Multiple females','mg':'Mixed group','rh':'Reverse harem','pa':'Any user point of view','pf':'Female user point of view','pm':'Male user point of view','u1':'Male–female pairing','u2':'Male–male romance','u3':'Female–female romance','u4':'LGBTQ+ content','u8':'Safe for work','j7':'Chief executive officer','li':'Live action','ai':'AI photorealistic portrait','dp':'Digital painting','kw':'Korean webtoon','an':'Japanese anime','wc':'Western comics','vn':'Visual novel','ot':'Otome game','cg':'Three-dimensional computer graphics','gc':'Game computer graphics','ph':'Photorealistic','rm':'Realistic','se':'Semi-realistic','st':'Stylized','pr':'Pretty young adult male','ha':'Handsome male','ma':'Masculine male','mt':'Mature male','sa':'Soft-featured male','am':'Androgynous male','be':'Beautiful female','cu':'Cute female','mb':'Mature female','gl':'Glamorous female','af':'Androgynous female','bh':'Black hair','bl':'Blond hair','br':'Brown hair','rn':'Red hair','sh':'Silver or white hair','lh':'Long hair'}
FULL_EN.update({'lu':'Luxurious','ro':'Romantic','vm':'Mysterious','vk':'Dangerous','db':'Dramatic','mu':'Military uniform','vp':'Vampire appearance','de':'Demon appearance','ap':'Angel appearance','wo':'Werewolf appearance','ea':'Animal ears','ar':'Fantasy armor','fr':'Formal attire','x2':'Narratively significant age gap'})
for group in GROUPS:
    for tag in group['tags']:tag['english_full']=FULL_EN.get(tag['code'],tag['canonical'])

def initial(name,serial):
    meta=dict(date='',channel='',buyer='',producer='',language='',format='VID',serial=f'{serial:03}',extension=Path(name).suffix.lower())
    # Only unambiguous leading metadata; never migrate old semantic tags.
    m=re.match(r'^Mellow[-_](\d{4}|\d{6}|\d{8})[-_]([A-Za-z0-9]+)[-_]([A-Za-z0-9]+)[-_]([A-Za-z0-9]+)(?:[-_][A-Za-z0-9]+)*?[-_](EN|JP|JA|KO|ZH|DE|FR|ES|PT)(?:[-_ (.]|$)',name,re.I)
    if m: meta.update(zip(('date','channel','buyer','producer','language'),m.groups()))
    if meta['producer'].upper()=='TMM':meta['producer']=''
    return dict(metadata=meta,tags={g['category']:['unk'] for g in GROUPS},na_reasons={},evidence={},story_segments=[],audio_review={'status':'pending','segments':[],'note':''},status='pending',issues=['等待画面、字幕及音轨核对'],original_name=name,version='V6',rule_revision=3)

def evaluate(data,has_audio=True,duration=None):
    d=copy.deepcopy(data);issues=[]
    try:
        result=validator.generate({**d.get('metadata',{}),'tags':d.get('tags',{}),'na_reasons':d.get('na_reasons',{})})
        issues.extend(result['errors']);d['warnings']=result['warnings'];d['proposed_name']=result.get('name','')
    except (ValueError,TypeError,KeyError) as e:issues.append(str(e));d['proposed_name']=''
    ranges=d.get('story_segments',[])
    valid_ranges=bool(ranges) and all(isinstance(r,dict) and isinstance(r.get('start'),(int,float)) and isinstance(r.get('end'),(int,float)) and 0<=r['start']<r['end'] and (duration is None or r['end']<=duration+.1) for r in ranges)
    if not valid_ranges:issues.append('缺少有效主体剧情时间段；须排除片尾营销设定')
    if d.get('visual_reviewed') is not True or d.get('subtitle_reviewed') is not True:issues.append('画面和剧情字幕尚未核对')
    audio=d.get('audio_review',{});status=audio.get('status')
    if has_audio:
        if status not in ('reviewed','no_dialogue'):issues.append('音轨尚未核对，不能正式命名')
        if not str(audio.get('note','')).strip():issues.append('缺少语音核对说明')
        if status=='reviewed' and not audio.get('segments'):issues.append('缺少带时间戳的对白转写')
    elif status!='no_audio':issues.append('无音轨视频须记录 no_audio')
    for seg in audio.get('segments',[]):
        if not isinstance(seg,dict) or not isinstance(seg.get('start'),(int,float)) or not isinstance(seg.get('end'),(int,float)) or not 0<=seg['start']<seg['end'] or duration is not None and seg['end']>duration+.1 or not isinstance(seg.get('text'),str):issues.append('音轨转写时间戳或文本无效');break
    evidence=d.get('evidence',{})
    for g in GROUPS:
        cat=g['category'];codes=d.get('tags',{}).get(cat,[])
        for code in codes:
            if code in ('unk','na'):continue
            ev=evidence.get(code,{})
            if not isinstance(ev,dict) or ev.get('source') not in ('visual','subtitle','dialogue','user') or not str(ev.get('observation','')).strip():issues.append(cat+' / '+code+' 缺少主体剧情证据');continue
            if ev['source']!='user':
                at=ev.get('at')
                if not isinstance(at,(int,float)) or not valid_ranges or not any(r['start']<=at<=r['end'] for r in ranges):issues.append(code+' 的证据不在主体剧情时间段')
    d['issues']=list(dict.fromkeys(issues));d['status']='ready' if not issues else 'pending';return d

def apply(asset,result,assets,manual=False):
    old=asset.get('v6',initial(asset.get('original_name',asset['name']),1))
    candidate={**old,**result,'metadata':{**old.get('metadata',{}),**result.get('metadata',{})}}
    if not manual: candidate['metadata']=copy.deepcopy(old.get('metadata',{}))
    candidate['metadata']['extension']=Path(asset.get('original_name',asset['name'])).suffix.lower()
    candidate['original_name']=asset.get('original_name',asset['name'])
    d=evaluate(candidate,asset.get('has_audio',True),asset.get('duration') or None)
    if d['status']=='ready' and any(x['id']!=asset['id'] and x['name']==d['proposed_name'] for x in assets):d['status']='pending';d['issues'].append('名称重复，请调整序号；不会覆盖原素材')
    if manual:d['manual_locked']=True
    if d['status']=='ready':
        asset.setdefault('original_name',asset['name']);asset['name']=d['proposed_name'];asset['language']=d['metadata']['language']
    asset['v6']=d;return d
