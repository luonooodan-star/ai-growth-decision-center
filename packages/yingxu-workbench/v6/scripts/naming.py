#!/usr/bin/env python3
import argparse,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'references/tags.json').read_text(encoding='utf-8'))
GROUPS=D['groups']
EXT={'.mp4','.mov','.m4v','.webm','.png','.jpg','.jpeg','.webp','.gif'}
def audit():
 codes=[t['code'] for g in GROUPS for t in g['tags']]
 assert len(GROUPS)==15 and len(codes)==200 and len(set(codes))==200
 assert not set(codes)&{'na','unk'}
 assert all(re.fullmatch(r'[a-z][a-z0-9]',c) for c in codes)
 return {'categories':15,'tags':200,'unique_codes':200,'dictionary_revision':D['dictionary_revision']}
def validate(name,draft=False,reasons=None):
 errors=[];warnings=[];reasons=reasons or {};ext=Path(name).suffix.lower()
 stem=name[:-len(ext)] if ext in EXT else name
 fields=stem.split('_');parsed={}
 if len(fields)!=24:return {'valid':False,'errors':['名称必须有 24 个字段'],'warnings':[]}
 if not stem.isascii():errors.append('名称只能使用 ASCII 字符')
 if len(stem)>180:errors.append('名称超过内部 180 字符上限')
 elif len(stem)>120:warnings.append('名称超过建议 120 字符，请复核次要标签')
 if fields[0]!='Mellow' or fields[-1]!='V6':errors.append('项目必须为 Mellow，版本必须为 V6')
 if not re.fullmatch(r'(?:\d{4}|\d{6}|\d{8})',fields[1]):errors.append('日期必须为原文件的 MMDD、YYMMDD 或 YYYYMMDD')
 else:
  from datetime import datetime
  try:datetime.strptime(('2000'+fields[1]) if len(fields[1])==4 else fields[1],'%Y%m%d' if len(fields[1])!=6 else '%y%m%d')
  except ValueError:errors.append('日期无效')
 for f in fields[2:6]:
  if not re.fullmatch(r'[A-Za-z0-9-]+',f):errors.append('渠道、人员和语言字段只允许字母数字及连字符')
 if fields[6] not in {'VID','IMG'}:errors.append('形式必须为 VID 或 IMG')
 if ext in EXT and ((fields[6]=='VID' and ext not in {'.mp4','.mov','.m4v','.webm'}) or (fields[6]=='IMG' and ext in {'.mp4','.mov','.m4v','.webm'})):errors.append('扩展名与 VID/IMG 不一致')
 if not re.fullmatch(r'\d{3,}',fields[22]):errors.append('序号必须为至少三位数字')
 for field,g in zip(fields[7:22],GROUPS):
  category=g['category'];tags=field.split('+');v={t['code']:t['label'] for t in g['tags']}
  if len(tags)!=len(set(tags)):errors.append(category+'存在重复标签')
  if g['recommended_max_tags']==1 and len(tags)!=1:errors.append(category+'只能选择一个主标签')
  elif len(tags)>g['recommended_max_tags']:warnings.append(category+'超过建议标签数量')
  for code in tags:
   if code=='unk':
    if not draft:errors.append(category+'仍待确认，不能正式交付')
   elif code=='na':
    if not isinstance(reasons.get(category),str) or not reasons[category].strip():errors.append(category+'的 na 需要人工复核原因')
   elif code not in v:errors.append(category+'包含未登记或错位短码：'+code)
  if any(t in {'na','unk'} for t in tags) and len(tags)!=1:errors.append(category+'状态码不可与真实标签混用')
  parsed[category]=[{'code':t,'label':v.get(t,'待确认' if t=='unk' else '不适用' if t=='na' else '无效')} for t in tags]
 return dict(valid=not errors,draft=draft,name=name,length=len(stem),errors=errors,warnings=warnings,tags=parsed)
def generate(data,draft=False):
 required=['date','channel','buyer','producer','language','format','serial','tags']
 missing=[k for k in required if k not in data]
 if missing:raise ValueError('缺少字段：'+','.join(missing))
 tags=data['tags'];expected={g['category'] for g in GROUPS}
 if not isinstance(tags,dict) or set(tags)!=expected:raise ValueError('tags 必须包含且仅包含全部15个大类')
 parts=[]
 for g in GROUPS:
  values=tags[g['category']]
  if not isinstance(values,list) or not values or not all(isinstance(t,str) and re.fullmatch(r'[a-z0-9]+',t) for t in values):raise ValueError(g['category']+'必须是非空短码数组')
  # Preserve the primary tag; normalize secondary order without silently dropping duplicates.
  order={t['code']:i for i,t in enumerate(g['tags'])}
  values=values[:1]+sorted(values[1:],key=lambda t:order.get(t,999))
  parts.append('+'.join(values))
 meta=[data[k] for k in required[:7]]
 if not all(isinstance(v,str) and '_' not in v for v in meta):raise ValueError('元数据和序号必须是无下划线字符串')
 name='_'.join(['Mellow']+meta[:6]+parts+[data['serial'],'V6'])
 ext=data.get('extension','')
 if ext and (not isinstance(ext,str) or ext.lower() not in EXT):raise ValueError('不支持的文件扩展名')
 return validate(name+ext,draft,data.get('na_reasons'))
def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
 sub.add_parser('audit');g=sub.add_parser('generate');g.add_argument('--input',required=True);g.add_argument('--draft',action='store_true')
 v=sub.add_parser('validate');v.add_argument('name');v.add_argument('--draft',action='store_true');v.add_argument('--reasons')
 a=p.parse_args()
 try:
  audit()
  if a.command=='audit':result=audit()
  elif a.command=='generate':result=generate(json.loads(Path(a.input).read_text(encoding='utf-8')),a.draft)
  else:result=validate(a.name,a.draft,json.loads(Path(a.reasons).read_text(encoding='utf-8')) if a.reasons else None)
 except (ValueError,TypeError,KeyError,AssertionError,OSError) as e:result={'valid':False,'errors':[str(e)]}
 print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result.get('valid',True) else 1
if __name__=='__main__':sys.exit(main())
