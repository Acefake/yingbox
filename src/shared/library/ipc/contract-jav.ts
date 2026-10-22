/**
 * 媒体库 IPC 契约 · 番号刮削：媒体库的元数据来源、番号站点与站点设置。
 *
 * 只有类型和常量，由 contract.ts 统一再导出。
 */

/**
 * 媒体库的元数据来源：tmdb（默认，按片名识别）或 jav（按文件名里的番号刮削番号站点）。
 * 添加媒体库时选定，之后不变（换来源等于重新分组，删掉重加即可）。
 */
export type LibrarySource = 'tmdb' | 'jav'

/** 全部来源，校验用。 */
export const LIBRARY_SOURCES: readonly LibrarySource[] = ['tmdb', 'jav']

/** 番号类别：有码 / 无码 / FC2 / 素人。决定去哪些站点查，也是番号页的「类型」筛选。 */
export type JavKind = 'censored' | 'uncensored' | 'fc2' | 'amateur'

/** 全部番号类别，校验用。 */
export const JAV_KINDS: readonly JavKind[] = [
  'censored',
  'uncensored',
  'fc2',
  'amateur',
]

/** 内置番号站点。 */
export type JavSiteId =
  | 'javbus'
  | 'dmm'
  | 'avbase'
  | 'r18dev'
  | 'javdb'
  | 'official'
  | 'prestige'
  | 'faleno'
  | 'dahlia'
  | 'mgstage'
  | 'xcity'
  | 'giga'
  | 'kin8'
  | 'avsox'
  | 'jav321'
  | 'fc2'
  | 'fc2ppvdb'
  | 'javlibrary'
  | 'iqqtv'
  | 'airav'
  | 'theporndb'
  | 'dmm_api'
  | 'freejavbt'
  | 'getchu'
  | 'fc2club'

/**
 * 站点显示名与说明（设置页用）。顺序即默认优先级：官方 / 字段全的在前，镜像与兜底在后；
 * 只查自家番号的厂商站按前缀过滤，不命中的番号不发请求，开着也不费事。
 */
export const JAV_SITES: ReadonlyArray<{
  id: JavSiteId
  name: string
  description: string
  /** 新装 / 新增时是否默认开启；缺省开启。 */
  defaultEnabled?: boolean
}> = [
  {
    id: 'javbus',
    name: 'JavBus',
    description: '有码 / 无码 / 素人，字段最全，有演员头像与剧照',
  },
  {
    id: 'dmm',
    name: 'FANZA (DMM)',
    description: '有码 / 部分素人，官方数据，高清封面；DVD 版需日本网络',
  },
  {
    id: 'avbase',
    name: 'AVBase',
    description: '有码 / 素人，带简介、导演，图片来自 FANZA',
  },
  {
    id: 'r18dev',
    name: 'R18.dev',
    description: '只查有码，FANZA 目录镜像，日文标题 / 演员头像 / 剧照',
  },
  {
    id: 'javdb',
    name: 'JavDB',
    description:
      '有码 / 无码 / 素人，有演员头像与剧照；Cloudflare 防护较严，FC2 需登录 Cookie',
  },
  {
    id: 'official',
    name: '厂商官网',
    description:
      '有码，S1 / MOODYZ / IdeaPocket 等 WILL 系厂商官网，按番号前缀直达',
  },
  {
    id: 'prestige',
    name: 'PRESTIGE',
    description:
      '只查 PRESTIGE 系番号（官方接口），有竖版海报与剧照；需日本网络',
  },
  {
    id: 'faleno',
    name: 'FALENO',
    description:
      '只查 FALENO / maryGOLD / JimmyScandal 番号，有竖版海报；需日本网络',
  },
  {
    id: 'dahlia',
    name: 'DAHLIA',
    description: '只查 DAHLIA 番号（DLDSS 等）',
  },
  {
    id: 'mgstage',
    name: 'MGS 動画',
    description: '素人（259LUXU、SIRO 等）与 Prestige 系，需日本网络',
  },
  {
    id: 'xcity',
    name: 'XCITY',
    description: '有码，有制作商 / 发行商 / 系列 / 导演',
  },
  {
    id: 'giga',
    name: 'GIGA',
    description: '只查 GIGA 特撮系番号，有剧照',
  },
  {
    id: 'kin8',
    name: '金髪天國',
    description: '无码，只查 KIN8-xxxx',
  },
  {
    id: 'avsox',
    name: 'AVSOX',
    description: '只查无码（Carib / 1pon / HEYZO 等），有演员头像',
  },
  {
    id: 'jav321',
    name: 'JAV321',
    description: '有码 / 素人，FANZA 数据镜像，带简介、剧照与演员头像',
  },
  {
    id: 'fc2',
    name: 'FC2',
    description: '只查 FC2-PPV 番号（FC2 官方商品页）',
  },
  {
    id: 'fc2ppvdb',
    name: 'FC2PPVDB',
    description: '只查 FC2，补网友整理的演员与标签',
  },
  {
    id: 'javlibrary',
    name: 'JAVLibrary',
    description: '只查有码，中文类别、导演、发行商；Cloudflare 防护较严',
    defaultEnabled: false,
  },
  {
    id: 'iqqtv',
    name: 'iQQTV',
    description: '有码 / 无码，中文简介；日期是上架日',
    defaultEnabled: false,
  },
  {
    id: 'airav',
    name: 'AIRAV',
    description: '有码 / 无码，中文简介；日期是上架日',
    defaultEnabled: false,
  },
  {
    id: 'theporndb',
    name: 'ThePornDB',
    description: '需填写 API 令牌；欧美 / 无码条目较多',
  },
  {
    id: 'dmm_api',
    name: 'DMM 官方 API',
    description: '需填写 API ID 与联盟 ID，未配置时自动跳过',
  },
  {
    id: 'freejavbt',
    name: 'FreeJavBT',
    description: '全类型兜底，日期与演员偶有错',
    defaultEnabled: false,
  },
  {
    id: 'getchu',
    name: 'Getchu',
    description: '成人动画（里番）按品番查，需日本网络',
    defaultEnabled: false,
  },
  {
    id: 'fc2club',
    name: 'FC2CLUB',
    description: '只查 FC2，站点疑似已失效',
    defaultEnabled: false,
  },
]

/** 番号站点设置：数组顺序即优先级（同一字段先取排在前面的站点的值）。 */
export interface JavSettings {
  sites: Array<{ id: JavSiteId; enabled: boolean }>
}

/** 默认：顺序同 JAV_SITES，开关按 defaultEnabled（缺省开启）。 */
export const DEFAULT_JAV_SETTINGS: JavSettings = {
  sites: JAV_SITES.map(site => ({
    id: site.id,
    enabled: site.defaultEnabled !== false,
  })),
}
