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

/** 内置番号站点。 */
export type JavSiteId =
  | 'javbus'
  | 'avbase'
  | 'fc2'
  | 'dmm'
  | 'dmm_api'
  | 'mgstage'
  | 'getchu'

/** 站点显示名与说明（设置页用）。 */
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
    id: 'avbase',
    name: 'AVBase',
    description: '有码 / 素人，带简介、导演，图片来自 FANZA',
  },
  {
    id: 'fc2',
    name: 'FC2',
    description: '只查 FC2-PPV 番号（FC2 官方商品页）',
  },
  {
    id: 'dmm',
    name: 'FANZA (DMM)',
    description: '有码 / 部分素人，官方数据，高清封面；DVD 版需日本网络',
  },
  {
    id: 'mgstage',
    name: 'MGS 動画',
    description: '素人（259LUXU、SIRO 等）与 Prestige 系，需日本网络',
  },
  {
    id: 'dmm_api',
    name: 'DMM 官方 API',
    description: '需要 DMM_API_ID / DMM_AFFILIATE_ID，未配置时自动跳过',
  },
  {
    id: 'getchu',
    name: 'Getchu',
    description: '成人动画（里番）按品番查，需日本网络，默认关闭',
    defaultEnabled: false,
  },
]

/** 番号站点设置：数组顺序即优先级（同一字段先取排在前面的站点的值）。 */
export interface JavSettings {
  sites: Array<{ id: JavSiteId; enabled: boolean }>
}

/** 默认：全部开启，javbus → avbase → fc2。 */
export const DEFAULT_JAV_SETTINGS: JavSettings = {
  sites: JAV_SITES.map(site => ({
    id: site.id,
    enabled: site.defaultEnabled !== false,
  })),
}
