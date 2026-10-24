/**
 * 媒体库 IPC 契约 · 海报墙查询的附加筛选：评分下限、制片国家、人名、条目 id 白名单 / 黑名单。
 *
 * 自然语言搜索把一句话解析成这些条件（见 renderer features/library/nl-search）；
 * 普通查询不带它们时行为不变。只有类型，由 contract.ts 统一再导出。
 */

/** LibraryQuery 的附加筛选字段（全部可选，同时给出时同时满足）。 */
export interface LibraryQueryFilters {
  /** 评分下限（含），0–10。 */
  ratingMin?: number
  /** 制片国家 / 地区（ISO 3166-1 两位代码，任一即可）。 */
  countries?: string[]
  /**
   * 人名（演员 / 导演 / 编剧等演职员，按名字或原名包含匹配，不分大小写）；
   * 给多个人时每个人都要参与。番号库还匹配演员库里的名字。
   */
  people?: string[]
  /** 只要这些条目（顶层条目 id）。 */
  ids?: number[]
  /** 排除这些条目。 */
  excludeIds?: number[]
}

/** ids / excludeIds 最多几个。 */
export const MAX_FILTER_IDS = 1000
