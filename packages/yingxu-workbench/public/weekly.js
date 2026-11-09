import {contentTags} from './content-tags.js';

const filters = new Map();
const day = (s,n) => new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const monday = s => day(s,-((new Date(s+'T00:00:00Z').getUTCDay()+6)%7));
const defaults = () => ({week:'',channel:'',country:'',window:'7'});
function direction(a,state) {
  if(a.v6){const g=state.v6_dictionary?.[0],t=g?.tags.find(t=>t.code===a.v6.tags?.['一级分类']?.[0]);return a.v6.status==='ready'&&t?t.label+' / '+(t.english_full||t.canonical):'V6 待核对 / Unconfirmed'}
  const {tags} = contentTags(a,state);
  if(tags.includes('狼人') && tags.some(t=>['命定伴侣','命定伴侣识别'].includes(t))) return '狼人命定';
  for(const group of ['关系与爱情套路','核心陪伴需求','剧情触发点与事件']) {
    const t=tags.find(t=>(state.tags[group]||[]).includes(t));
    if(t) return t;
  }
  return '待定方向';
}
const identity = (date,channel,country,id,name) => JSON.stringify([date,channel||'',country||'',String(id||''),name||'']);
function matureReturns(facts,cohorts,asOf,age) {
  const owners=new Map(), seen=new Set(), out=new Map();
  for(const f of facts){
    const k=identity(f.date,f.channel,f.country,f.creative_id,f.creative_name);
    if(!owners.has(k)) owners.set(k,new Set());
    owners.get(k).add(f.asset_id);
  }
  for(const c of cohorts){
    if(c.metric_id!=='revenue'||c.cohort_unit!=='D'||String(c.cohort_index)!==String(age)||c.match_status!=='matched'||!['1','true'].includes(String(c.observation_complete).toLowerCase()))continue;
    if(!c.install_date||day(c.install_date,age)>asOf||c.cumulative_metric_value==null||!(Number(c.cohort_spend)>0))continue;
    const k=identity(c.install_date,c.media_source,c.country_code,c.creative_id,c.creative_name);
    const ids=owners.get(k), unique=JSON.stringify([k,c.campaign_id,c.adgroup_id]);
    if(ids?.size!==1||seen.has(unique))continue;
    seen.add(unique);
    const [id]=ids, v=out.get(id)||{cost:0,revenue:0};
    v.cost+=Number(c.cohort_spend);v.revenue+=Number(c.cumulative_metric_value);out.set(id,v);
  }
  return out;
}
export function weeklyPage(state,product,{esc,title,money,pct,num,localdate,calc,scriptName}){
  const f=filters.get(product)||defaults();filters.set(product,f);
  const lastUpload=state.assets.map(a=>localdate(a.uploaded_at)).sort().at(-1);
  f.week ||= monday(lastUpload||localdate(Date.now()));
  const end=day(f.week,6), all=state.assets.filter(a=>{const d=localdate(a.uploaded_at);return d>=f.week&&d<=end});
  const ids=new Set(all.map(a=>a.id)), groups=new Map();
  for(const a of all){const k=direction(a,state);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(a)}
  const matched=state.facts.filter(r=>r.bucket==='single'&&ids.has(r.asset_id)&&(!f.channel||r.channel===f.channel)&&(!f.country||r.country===f.country));
  const first=new Map();
  for(const r of matched)if(r.spend>0&&(!first.has(r.asset_id)||r.date<first.get(r.asset_id)))first.set(r.asset_id,r.date);
  const facts=matched.filter(r=>f.window==='all'||(first.has(r.asset_id)&&r.date>=first.get(r.asset_id)&&r.date<day(first.get(r.asset_id),Number(f.window))));
  const byAsset=new Map();
  for(const r of facts){if(!byAsset.has(r.asset_id))byAsset.set(r.asset_id,[]);byAsset.get(r.asset_id).push(r)}
  const returnsByAge=new Map([0,7].map(age=>[age,matureReturns(facts,state.cohorts||[],state.recovery_as_of||'',age)]));
  const stats=assets=>{
    const rows=assets.flatMap(a=>byAsset.get(a.id)||[]), m=calc(rows);
    function recovery(age){
      const observed=assets.map(a=>returnsByAge.get(age).get(a.id)).filter(Boolean);
      const cost=observed.reduce((sum,v)=>sum+v.cost,0);
      const revenue=observed.reduce((sum,v)=>sum+v.revenue,0);
      if(product==='demo'){
        const mature=assets.filter(a=>(byAsset.get(a.id)||[]).some(r=>r['d'+age+'_complete']&&r['d'+age+'_revenue']!=null&&r.spend>0)).length;
        return {rate:m['d'+age+'_roas'],mature};
      }
      return {rate:cost?revenue/cost:null,mature:observed.length};
    }
    const d7=recovery(7);
    return {m,tested:assets.filter(a=>first.has(a.id)).length,mature:d7.mature,roas:d7.rate,d0:recovery(0).rate};
  };
  const options=(key,label)=>'<option value="">'+label+'</option>'+[...new Set(state.facts.map(r=>r[key]).filter(Boolean))].sort().map(v=>'<option '+(f[key]===v?'selected':'')+'>'+esc(v)+'</option>').join('');
  const assetLabel=name=>{
    const stem=name.replace(/\.(mp4|mov)$/i,'');
    if(stem.length<=22)return stem;
    const suffix=stem.match(/(?:^|_)(\d+_V\d+)$/i);
    return suffix ? stem.slice(0,11)+'…'+suffix[1] : stem.slice(0,11)+'…'+stem.slice(-8);
  };
  const shortName=name=>'<span class="weekly-name" title="'+esc(name)+'">'+esc(name)+'</span>';
  const detailLine=(label,values,total)=>{
    const {tested,m,d0,roas}=values;
    return `<span class="weekly-heading">${label}<span title="已测数 / 成片总数">（${tested}/${total}）</span></span>
      <span class="weekly-chips"><span>花费 ${money(m.spend)}</span><span>D0 ${pct(d0)}</span><span>D7 ${pct(roas)}</span></span>`;
  };
  const row=(name,assets)=>{
    const {m,tested,roas,mature,d0}=stats(assets);
    const scripts=new Map();
    for(const a of assets){const id=a.script_id||'';if(!scripts.has(id))scripts.set(id,[]);scripts.get(id).push(a)}
    const drill=[...scripts].map(([id,members])=>{
      const s=stats(members);
      return '<details><summary>'+detailLine(shortName(id?scriptName(id):'尚未归组'),s,members.length)+'</summary>'+members.map(a=>{
        const button='<button class="asset-name weekly-name" title="'+esc(a.name)+'" data-detail="'+esc(a.id)+'">'+esc(assetLabel(a.name))+'</button>';
        return '<div>'+detailLine(button,stats([a]),1)+'</div>';
      }).join('')+'</details>';
    }).join('');
    return '<tr><td><div class=weekly-tree><details><summary>'+shortName(name)+'</summary>'+drill+'</details></div></td><td>'+[...scripts.keys()].filter(Boolean).length+'</td><td>'+assets.length+'</td><td>'+pct(assets.length/all.length)+'</td><td>'+tested+'/'+assets.length+' · '+pct(tested/assets.length)+'</td><td>'+money(m.spend)+'</td><td>'+num(m.installs)+'</td><td>'+money(m.cpi)+'</td><td>'+pct(d0)+'</td><td>'+pct(roas)+'</td><td>'+mature+'</td></tr>';
  };
  return title('每周方向复盘','按首次入库周统计成片。展开方向可查看脚本，再点素材名称查看详情。')+
    '<section class="panel"><div class="toolbar"><label>入库周 <input type="date" id="weekly-week" value="'+f.week+'"></label><label>渠道 <select id="weekly-channel">'+options('channel','全部渠道')+'</select></label><label>市场 <select id="weekly-country">'+options('country','全部市场')+'</select></label><label>投放观察期 <select id="weekly-window">'+[['7','首个观测消耗日起 7 天'],['3','首个观测消耗日起 3 天'],['all','全部已同步日期']].map(([v,l])=>'<option value="'+v+'" '+(v===f.window?'selected':'')+'>'+l+'</option>').join('')+'</select></label></div>'+
    '<div class="panel-head"><h2>'+f.week+' 至 '+end+'</h2><span>'+all.length+' 条成片 · 已观测消耗 '+first.size+' 条</span></div>'+
    '<div class="table-wrap"><table><thead><tr>'+['主方向 / 脚本 / 素材','已归组脚本','成片','产出占比','测试覆盖','花费','安装','CPI','D0 ROAS','成熟 D7 ROAS','D7 有数成片'].map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody>'+[...groups].sort((a,b)=>b[1].length-a[1].length).map(([k,v])=>row(k,v)).join('')+'</tbody></table></div>'+
    (all.length?'':'<div class="empty">本周没有入库素材，可选择其他周。</div>')+
    '<div class="footer-row">每片只计一个方向。优先使用人工标签，其次使用 AI 标签；先匹配狼人命定，再取关系套路、陪伴需求或剧情事件。缺少对应标签的素材计入待定方向。</div>'+
    '<div class="footer-row">市场和渠道仅筛选投放。测试覆盖按已关联单素材且有正消耗的成片计算。观察期从所选范围首个已观测消耗日开始，近期素材可能未跑满。D0 和 D7 分别汇总成熟同期群的累计收入和对应成本。缺数显示 —。</div></section>';
}
export function bindWeekly(product,render){
  const f=filters.get(product);
  for(const key of ['week','channel','country','window']){
    document.getElementById('weekly-'+key).onchange=e=>{
      if(key==='week'&&!e.target.value)return;
      f[key]=key==='week'?monday(e.target.value):e.target.value;render();
    };
  }
}
