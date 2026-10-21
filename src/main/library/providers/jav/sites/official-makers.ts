/**
 * 厂商官网路由表：番号前缀 → 厂商官网。
 *
 * 表里的厂商都用同一套官网系统（S1 / MOODYZ / IdeaPocket 等 WILL 系厂牌），
 * 详情页地址都是 `https://<域名>/works/detail/<小写番号去横线>`，页面结构一致，由 official.ts 统一解析。
 * 新增厂商只改这张表：域名、显示名（作制作商兜底）、该厂商在官网上发布的番号前缀（小写）。
 * 前缀清单整理自 Amane 的 official 路由表，按厂商重新组织。
 */

/** 一个厂商官网。 */
export interface OfficialMaker {
  /** 官网域名（不带协议）。 */
  domain: string
  /** 制作商显示名：页面标题里认不出时用它。 */
  name: string
  /** 官网发布的番号前缀：小写字母、空格分隔（不含素人番号的数字前缀）。 */
  prefixes: string
}

/** 全部厂商官网。 */
export const OFFICIAL_MAKERS: readonly OfficialMaker[] = [
  {
    domain: 's1s1s1.com',
    name: 'S1 NO.1 STYLE',
    prefixes: 'sivr ssis ssni snis soe oned one onsd ofje sps tksoe sone snos',
  },
  {
    domain: 'moodyz.com',
    name: 'MOODYZ',
    prefixes:
      'mdvr midv mide midd mibd mimk miid migd mifd miae miad miaa mdl mdj mdi mdg mdf mde mdld mded mizd mird mdjd rmid mdid mdmd mimu mdpd mivd mdud mdgd mdvd mias miqd mint rmpd mdrd tkmide tkmidd kmide tkmigd mdfd rmwd miab mida',
  },
  {
    domain: 'www.madonna-av.com',
    name: 'Madonna',
    prefixes:
      'juvr jusd juq juy jux jul juk juc jukd oba roeb roe ure mdon obe jums',
  },
  {
    domain: 'www.wanz-factory.com',
    name: 'WANZ FACTORY',
    prefixes: 'wavr waaa bmw wanz',
  },
  {
    domain: 'ideapocket.com',
    name: 'IDEA POCKET',
    prefixes:
      'ipvr ipx ipz iptd ipsd idbd supd ipit and hpd tkipz ipzz cosd anpd dan alad kipx',
  },
  {
    domain: 'kirakira-av.com',
    name: 'kira☆kira',
    prefixes: 'kivr blk kibd kifd kird kisd set',
  },
  {
    domain: 'www.av-e-body.com',
    name: 'E-BODY',
    prefixes: 'ebvr ebod mkck eyan',
  },
  {
    domain: 'bi-av.com',
    name: '痴女ヘブン',
    prefixes: 'cjvr cjod bbi bib cjob beb bid bist bwb',
  },
  {
    domain: 'premium-beauty.com',
    name: 'PREMIUM',
    prefixes: 'prvr pgd pred pbd pjd prtd pxd pid ptv',
  },
  {
    domain: 'miman.jp',
    name: '未満',
    prefixes: 'mmvr mmnd mmxd aom',
  },
  {
    domain: 'tameikegoro.jp',
    name: '溜池ゴロー',
    prefixes: 'mevr meyd mbyd mdyd mnyd',
  },
  {
    domain: 'fitch-av.com',
    name: 'Fitch',
    prefixes: 'fcvr jufe jufd jfb juny nyb finh gcf nima',
  },
  {
    domain: 'kawaiikawaii.jp',
    name: 'kawaii*',
    prefixes: 'kavr cawd kwbd kawd kwsr kwsd kane cawb',
  },
  { domain: 'befreebe.com', name: 'BeFree', prefixes: 'bf' },
  {
    domain: 'muku.tv',
    name: '無垢',
    prefixes: 'mucd mudr mukd smcd mukc',
  },
  {
    domain: 'attackers.net',
    name: 'Attackers',
    prefixes: 'atvr rbk rbd same shkd atid adn atkd jbd sspd atad azsd',
  },
  {
    domain: 'mko-labo.net',
    name: 'えむっ娘ラボ',
    prefixes: 'mvr mism emlb',
  },
  {
    domain: 'dasdas.jp',
    name: 'DAS',
    prefixes: 'dsvr dass dazd dasd pla',
  },
  { domain: 'mvg.jp', name: "M's Video Group", prefixes: 'mvbd mvsd' },
  { domain: 'av-opera.jp', name: 'OPERA', prefixes: 'opvr opbd opud' },
  {
    domain: 'oppai-av.com',
    name: 'OPPAI',
    prefixes: 'ppvr pppe ppbd pppd ppsd ppfd',
  },
  { domain: 'v-av.com', name: 'V', prefixes: 'vvvd vicd vizd vspd' },
  {
    domain: 'to-satsu.com',
    name: '変態紳士倶楽部',
    prefixes: 'clvr stol club',
  },
  { domain: 'bibian-av.com', name: 'ビビアン', prefixes: 'bbvr bban' },
  {
    domain: 'honnaka.jp',
    name: '本中',
    prefixes: 'hnvr hmn hndb hnd krnd hnky hnjc hnse',
  },
  { domain: 'rookie-av.jp', name: 'ROOKIE', prefixes: 'rvr rbb rki' },
  {
    domain: 'nanpa-japan.jp',
    name: 'ナンパJAPAN',
    prefixes: 'njvr nnpj npjb',
  },
  {
    domain: 'hajimekikaku.com',
    name: 'はじめ企画',
    prefixes: 'hjbb hjmo avgl',
  },
  {
    domain: 'hhh-av.com',
    name: 'Hunter',
    prefixes: 'huntb hunta hunt hunbl royd tysf',
  },
]

/** 前缀 → 厂商的索引（模块加载时建一次）。同一前缀出现两次时以表里靠前的为准。 */
const BY_PREFIX: ReadonlyMap<string, OfficialMaker> = (() => {
  const index = new Map<string, OfficialMaker>()
  for (const maker of OFFICIAL_MAKERS) {
    for (const prefix of maker.prefixes.split(/\s+/)) {
      if (!index.has(prefix)) index.set(prefix, maker)
    }
  }
  return index
})()

/**
 * 番号 → 厂商官网。取番号的字母前缀（去掉素人番号的数字前缀）查表；查不到返回 undefined。
 *
 * @example makerOf('SSIS-497') // s1s1s1.com
 */
export function makerOf(code: string): OfficialMaker | undefined {
  const prefix = /^\d*([a-z]+)/.exec(code.toLowerCase().replace(/[-_\s]/g, ''))
  return prefix ? BY_PREFIX.get(prefix[1]) : undefined
}
