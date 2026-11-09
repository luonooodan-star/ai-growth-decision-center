const appearanceGroups=['画风','性别呈现','外观年龄感','体型','发长','发色','发质与发型','面部毛发','服装','显著细节','造型气质'];
const priority=['角色职业','角色身份','当前关系','剧情触发点与事件','关系与爱情套路','角色人设','画风','显著细节','服装','造型气质','体型','发色',...appearanceGroups,'核心陪伴需求','核心体验承诺','场景','情绪','吸引方式'];
export function contentTags(a,state){
 const formal=a.tags||[];
 // Script approval locks the asset too; it does not approve content tags.
 const lastReview=(state.audit||[]).filter(l=>l.after?.id===a.id&&['人工复核','撤销复核'].includes(l.action)).sort((x,y)=>(y.after.revision||0)-(x.after.revision||0))[0];
 const confirmed=a.tags_confirmed===true||formal.length>0||lastReview?.action==='人工复核';
 const analysis=(state.analyses||[]).find(r=>r.id===a.analysis_id);
 const source=confirmed?'人工标签':analysis?(analysis.sufficient_visual_evidence?'AI建议':'采样记录'):'';
 const input=[...new Set(confirmed?formal:analysis?.tags||[])];
 const taxonomy=state.tags||{};
 const appearance=new Set(appearanceGroups.flatMap(k=>taxonomy[k]||[]));
 const rank=t=>{const i=priority.findIndex(k=>(taxonomy[k]||[]).includes(t));return i<0?priority.length:i};
 input.sort((x,y)=>rank(x)-rank(y));
 let count=0;
 const tags=input.filter(t=>!appearance.has(t)||++count<=2);
 const empty=confirmed?'未设置标签':analysis||a.analysis_status==='completed'?'未提取到标签':a.analysis_status==='failed'?'分析失败':a.analysis_status==='running'?'分析中':'等待分析';
 return {tags,source,empty,limited:input.length-tags.length};
}
export function contentTagsCell(a,state,esc){
 const {tags,source,empty,limited}=contentTags(a,state);
 if(!tags.length)return `<span class="muted">${empty}</span>${source?`<div class="content-tag-source">${source}</div>`:''}`;
 const chips=xs=>xs.map(t=>`<span class="tag">${esc(t)}</span>`).join('');
 return `<div class="content-tags"><div class="content-tag-chips">${chips(tags.slice(0,3))}${tags.length>3?`<details class="content-tags-more"><summary aria-label="展开或收起 ${esc(a.name)} 的内容标签"><span class="tags-more-count">+${tags.length-3}</span><span class="tags-more-collapse">收起</span></summary><div class="content-tags-expanded">${chips(tags.slice(3))}${limited?'<small>外形标签按当前规则最多展示2个，原始结果保留在详情。</small>':''}</div></details>`:''}</div><div class="content-tag-source">${source}</div></div>`;
}
