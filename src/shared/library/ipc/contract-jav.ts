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
  | 'javdb'
  | 'avbase'
  | 'javlibrary'
  | 'jav321'
  | 'avsox'
  | 'fc2'

/** 站点显示名与说明（设置页用）。 */
export const JAV_SITES: ReadonlyArray<{
  id: JavSiteId
  name: string
  description: string
}> = [
  {
    id: 'javbus',
    name: 'JavBus',
    description: '有码 / 无码 / 素人，字段最全，有演员头像与剧照',
  },
  {
    id: 'javdb',
    name: 'JavDB',
    description:
      '有码 / 无码 / 素人，有演员头像与剧照；Cloudflare 防护较严，FC2 需登录 Cookie',
  },
  {
    id: 'avbase',
    name: 'AVBase',
    description: '有码 / 素人，带简介、导演，图片来自 FANZA',
  },
  {
    id: 'javlibrary',
    name: 'JAVLibrary',
    description: '只查有码，中文类别、导演、发行商；Cloudflare 防护较严',
  },
  {
    id: 'jav321',
    name: 'JAV321',
    description: '有码 / 素人，FANZA 数据镜像，带简介、剧照与演员头像',
  },
  {
    id: 'avsox',
    name: 'AVSOX',
    description: '只查无码（Carib / 1pon / HEYZO 等），有演员头像',
  },
  {
    id: 'fc2',
    name: 'FC2',
    description: '只查 FC2-PPV 番号（FC2 官方商品页）',
  },
]

/** 番号站点设置：数组顺序即优先级（同一字段先取排在前面的站点的值）。 */
export interface JavSettings {
  sites: Array<{ id: JavSiteId; enabled: boolean }>
}

/** 默认：全部开启，顺序同 JAV_SITES。 */
export const DEFAULT_JAV_SETTINGS: JavSettings = {
  sites: JAV_SITES.map(site => ({ id: site.id, enabled: true })),
}
