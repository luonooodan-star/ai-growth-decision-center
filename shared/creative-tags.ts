import type { CreativeTagParse } from './creative-analysis.interface';

/** V2 vocabulary, preserved by dimension. Shared codes stay explicitly ambiguous. */
export const CREATIVE_TAG_GROUPS = [
  [
    'composition',
    '人物组合',
    'solomale:单男,solofemale:单女,dualmale:双男,dualfemale:双女,malefemale:男女双人,multimale:多男,multifemale:多女,mixedgroup:混合群像,rharem:逆后宫',
  ],
  [
    'category',
    '一级分类',
    'dark:暗黑恋爱,slow:慢热,pure:纯爱,forb:禁忌,elite:精英世界,fantasy:幻想',
  ],
  [
    'relation',
    '关系与情节',
    'captive:囚禁关系,stalker:跟踪关系,master:主仆,etl:欢喜冤家,forced:被迫接近,poss:占有欲,yandere:病娇,mafia:黑帮,villain:反派,dangerlove:危险爱情,power:权力博弈,revenge:复仇,jealous:嫉妒,angst:虐恋,mys:神秘,military:军旅,postapoc:末日,abo:ABO,rivals:对手,stl:陌生人变恋人,exes:旧情复燃,roommate:室友,slowburn:慢热,heartbreak:心碎,hurtcomfort:伤痛慰藉,campus:校园,modern:现代,childhood:青梅竹马,ftl:朋友变恋人,crush:暗恋,husband:丈夫,golden:忠犬,forbidden:禁忌之恋,agegap:年龄差,teacherstu:师生,stepbro:继兄弟,secret:秘密恋人,doctor:医生,professor:教授,bossemp:上下级,bgprincess:保镖公主,fakedate:假恋爱,oldmoney:老钱,billion:亿万富翁,celeb:名人,knight:骑士,nonhuman:非人类,demon:恶魔,angel:天使,vampire:吸血鬼,werewolf:狼人,magicacad:魔法学院,medieval:中世纪奇幻,supernatural:超自然,mythology:神话,cyber:赛博朋克',
  ],
  [
    'archetype',
    '人物原型',
    'dom:主导型,cold:冷漠,gentle:温柔,playful:顽皮,danger:危险,protect:保护型,intel:知性,badboy:坏男孩,mys:神秘,poss:占有欲,flirty:撩人,stoic:克制,aro:傲慢,caring:体贴,doting:宠溺,broken:破碎感,jealous:嫉妒,teasing:爱逗弄,mature:成熟,puppy:小奶狗,golden:忠犬,yandere:病娇',
  ],
  [
    'art',
    '画面形式',
    'live:真人实拍,air:AI写实肖像,dp:数字绘画,kw:韩漫,anime:日漫,wc:欧美漫画,vn:视觉小说,otome:乙女游戏,3dcg:三维CG,gamecg:游戏CG',
  ],
  ['render', '渲染风格', 'photo:照片级写实,real:写实,semi:半写实,style:风格化'],
  [
    'aesthetic',
    '人物审美',
    'pretty:精致美少年,handsome:帅气男主,masc:阳刚男主,maturem:成熟男主,softm:柔和男主,androm:中性男性,beautyf:美丽女主,cutef:可爱女主,maturef:成熟女主,glamf:艳丽女主,androf:中性女性',
  ],
  [
    'mood',
    '视觉氛围',
    'dark:暗黑,gothic:哥特,lux:奢华,rom:浪漫,sensual:感官魅力,danger:危险,mys:神秘,dreamy:梦幻,soft:柔和,cute:可爱,drama:戏剧化,fantasy:奇幻,warm:温暖',
  ],
  [
    'appearance',
    '外观特征',
    'blackhair:黑发,blond:金发,brownhair:棕发,redhair:红发,silverhair:银白发,longhair:长发,suit:西装,uniform:制服,miluniform:军装,armor:奇幻盔甲,glasses:眼镜,tattoo:纹身,shirtless:裸上身,formal:正装,vampapp:吸血鬼外观,demonapp:恶魔外观,angelapp:天使外观,wolfapp:狼人外观,animalears:兽耳',
  ],
] as const;
export const CREATIVE_TAGS: Record<
  string,
  { code: string; labels: string[]; groups: string[] }
> = Object.create(null);
const known = (code: string) =>
  Object.prototype.hasOwnProperty.call(CREATIVE_TAGS, code);
for (const [group, , entries] of CREATIVE_TAG_GROUPS) {
  for (const entry of entries.split(',')) {
    const [code, label] = entry.split(':');
    const item = (CREATIVE_TAGS[code] ||= { code, labels: [], groups: [] });
    if (!item.labels.includes(label)) item.labels.push(label);
    item.groups.push(group);
  }
}

export function parseCreativeTags(name: string): CreativeTagParse {
  const tokens = name
    .replace(/\s+\(\d{5,}\)\s*$/, '')
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean);
  const end = tokens.lastIndexOf('v2');
  if (end < 0)
    return {
      version: 'unknown',
      codes: [],
      unknown: [],
      warnings: ['没有明确的 V2 标记'],
    };
  // Both original mellow_img_... and the deployed Mellow_MMDD_channel_designer_creator_LANG_... format.
  let start = tokens.findIndex(
    (code) =>
      code === 'img' ||
      code === 'vid' ||
      CREATIVE_TAGS[code]?.groups.includes('composition'),
  );
  if (
    tokens[0] === 'mellow' &&
    /^\d{4}$/.test(tokens[1] || '') &&
    /^[a-z]{2,3}$/.test(tokens[5] || '')
  )
    start = 6;
  if (start < 0) start = tokens.findIndex(known);
  if (start < 0 || start >= end)
    return {
      version: 'v2',
      codes: [],
      unknown: [],
      warnings: ['未识别到 V2 语义标签'],
    };
  const semantic = tokens
    .slice(start, end)
    .filter((code) => !/^\d+$/.test(code) && !['img', 'vid'].includes(code));
  const codes = [...new Set(semantic.filter(known))];
  const unknown = [...new Set(semantic.filter((code) => !known(code)))];
  const warnings: string[] = [];
  if (unknown.length) warnings.push(`词表外代码：${unknown.join('、')}`);
  if (codes.length < 8 || codes.length > 10)
    warnings.push(`识别到 ${codes.length} 个标准语义标签，V2 目标为 8–10 个`);
  if (semantic.length !== new Set(semantic).size) warnings.push('含重复代码');
  return { version: 'v2', codes, unknown, warnings };
}

export const isMetaAttribution = (channel: string) =>
  [
    'facebook',
    'instagram',
    'audience_network',
    'facebook installs',
    'instagram installs',
    'off-facebook installs',
    'facebook_web',
    'xiye_milo_ios_web_pruchase',
  ].includes(channel.trim().toLowerCase());

/** iOS stores a filename followed by the Meta ad ID; never use ad_id (device ID). */
export function iosCreative(raw: unknown) {
  const text = raw == null ? '' : String(raw).trim();
  if (['', 'null', 'undefined', 'unknown', '0'].includes(text.toLowerCase()))
    return { name: '', id: '' };
  if (/^\d+$/.test(text)) return { name: '', id: text };
  const match = text.match(/\s+\((\d{5,})\)\s*$/);
  return {
    name: match ? text.slice(0, match.index).trim() : text,
    id: match?.[1] || '',
  };
}
