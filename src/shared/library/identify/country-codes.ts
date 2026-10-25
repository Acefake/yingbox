/**
 * 国家 / 地区名 → ISO 3166-1 两位代码。
 *
 * 本地 NFO 的 <country> 与豆瓣条目的地区都是名字（「美国」「United States of America」「中国大陆」），
 * 而海报墙的地区筛选按 metadata.countries 里的 ISO 代码比较（与 TMDB 一致），这里统一换算。
 * 只收常见产地；认不出的名字返回 undefined，由调用方丢弃。
 */

/** 每个代码的常见写法（中文、英文、简称），比较时不分大小写。 */
const NAMES: Record<string, readonly string[]> = {
  CN: [
    '中国',
    '中国大陆',
    '大陆',
    '内地',
    'china',
    'mainland china',
    "people's republic of china",
  ],
  HK: ['香港', '中国香港', 'hong kong', 'hong kong sar china'],
  TW: ['台湾', '中国台湾', '台灣', 'taiwan'],
  MO: ['澳门', '中国澳门', 'macau', 'macao'],
  US: [
    '美国',
    'united states',
    'united states of america',
    'usa',
    'us',
    'america',
  ],
  GB: ['英国', 'united kingdom', 'uk', 'great britain', 'england', 'britain'],
  JP: ['日本', 'japan'],
  KR: [
    '韩国',
    '南韩',
    'south korea',
    'korea',
    'korea, republic of',
    'republic of korea',
  ],
  FR: ['法国', 'france'],
  DE: ['德国', '西德', 'germany', 'west germany'],
  IT: ['意大利', 'italy'],
  ES: ['西班牙', 'spain'],
  IN: ['印度', 'india'],
  TH: ['泰国', 'thailand'],
  CA: ['加拿大', 'canada'],
  AU: ['澳大利亚', '澳洲', 'australia'],
  NZ: ['新西兰', 'new zealand'],
  RU: ['俄罗斯', '苏联', 'russia', 'russian federation', 'soviet union'],
  SE: ['瑞典', 'sweden'],
  DK: ['丹麦', 'denmark'],
  NO: ['挪威', 'norway'],
  IE: ['爱尔兰', 'ireland'],
  BE: ['比利时', 'belgium'],
  NL: ['荷兰', 'netherlands'],
  MX: ['墨西哥', 'mexico'],
  BR: ['巴西', 'brazil'],
  AR: ['阿根廷', 'argentina'],
  SG: ['新加坡', 'singapore'],
  MY: ['马来西亚', 'malaysia'],
  PH: ['菲律宾', 'philippines'],
  ID: ['印度尼西亚', '印尼', 'indonesia'],
  VN: ['越南', 'vietnam', 'viet nam'],
  TR: ['土耳其', 'turkey', 'türkiye'],
  IR: ['伊朗', 'iran', 'iran, islamic republic of'],
  PL: ['波兰', 'poland'],
}

const BY_NAME = new Map<string, string>()
for (const [code, names] of Object.entries(NAMES)) {
  for (const name of names) BY_NAME.set(name.toLowerCase(), code)
}

/** 名字（或已经是两位代码）→ ISO 代码；认不出返回 undefined。 */
export function countryCode(name: string): string | undefined {
  const text = name.trim()
  if (!text) return undefined
  const hit = BY_NAME.get(text.toLowerCase())
  if (hit) return hit
  // 两位代码大小写都认（「us」「Us」→ US）；只认表里有的代码，用 hasOwn 不碰原型链
  const code = text.toUpperCase()
  return /^[A-Z]{2}$/.test(code) && Object.hasOwn(NAMES, code)
    ? code
    : undefined
}

/** 一组名字 → 去重后的 ISO 代码（保持出现顺序，认不出的丢弃）。 */
export function countryCodes(names: readonly string[]): string[] {
  const out = new Set<string>()
  for (const name of names) {
    const code = countryCode(name)
    if (code) out.add(code)
  }
  return [...out]
}
