"""写入明确标记的虚构演示数据；不修改真实产品工作区。"""
import server as s
from datetime import datetime,timedelta,timezone
s.init()
with s.LOCK:
    data=s.load('demo')
    if data['assets'] or data['scripts']: raise SystemExit('演示空间已有内容，未覆盖。')
    stamp=datetime.now(timezone.utc)-timedelta(days=9)
    for i,title in enumerate(['睡前的一句晚安','重逢后的选择','与你一起探索故事']):
        sid=f'DEMO-S{i}';aid=f'DEMO-A{i}';dt=stamp+timedelta(days=i)
        data['scripts'].append(dict(id=sid,name=title,summary='虚构演示脚本，用于体验素材管理与报表。',version=1,created_at=dt.isoformat()))
        data['assets'].append(dict(id=aid,name=title+'（虚构样例）.mp4',file='',uploaded_at=dt.isoformat(),batch='DEMO-BATCH',creator='演示',duration=20,language='EN',script_id=sid,source_type='',source_id='',tags=[['主动关心','日常陪伴'],['重逢','破镜重圆'],['剧情探索','角色幻想']][i],tags_confirmed=True,classification='新脚本首批',state='完成',analysis_status='pending',analysis_error='演示占位，无真实视频或 AI 分析',quality='规则未配置',variation='',reason='明确标记的虚构数据',revision=1,manual_locked=True))
        data['facts'].append(dict(id=f'DEMO-F{i}',date=dt.date().isoformat(),channel='Meta',country='US',creative_id=f'DEMO-C{i}',creative_name=title,spend=100+50*i,impressions=10000+2000*i,clicks=250+30*i,installs=30+5*i,bucket='single',asset_id=aid,d0_complete=True,d7_complete=True,d30_complete=False,d0_revenue=30,d7_revenue=80,d30_revenue=None,d0_payers=3,source_dimensions={'campaign_id':'DEMO','campaign_name':'虚构演示'}))
    s.save('demo',data)
print('已创建 3 条虚构演示素材；真实产品仍为空。')
