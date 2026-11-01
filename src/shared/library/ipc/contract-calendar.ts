/**
 * 媒体库 IPC 契约 · 追剧日历：剧集库里已匹配 TMDB 的剧，按播出日期列出某段日期内的每一集。
 *
 * 播出信息来自 TMDB 剧集详情（next_episode_to_air / last_episode_to_air、各季播出日）和季详情
 * （每集 air_date），在引擎里缓存，每部剧每天最多向 TMDB 刷新一次。已看 / 未看由渲染层按播放记录判断。
 * 只有类型和常量，由 contract.ts 统一再导出。
 */

/** 请求：闭区间 [from, to]，日期都是 YYYY-MM-DD。 */
import type { SeriesCategory } from '../../contract/series-category'

export interface CalendarRequest {
  from: string
  to: string
}

/** 一次最多查多少天（翻周、列表视图都远小于这个数）。 */
export const CALENDAR_MAX_DAYS = 62

/** 日历里的一集。 */
export interface CalendarEpisode {
  /** 剧（series 条目）的 id，打开详情用。 */
  seriesId: number
  libraryId: number
  seriesTitle: string
  /** 剧的原名（TMDB original_name）；与剧名相同或没有时为 null。追更搜不到剧名时再用它搜。 */
  originalTitle: string | null
  /**
   * 剧的 TMDB id。片库重建后条目 id 会变，追更靠它认出是同一部剧；
   * 旧版片库服务不给，所以可选。
   */
  tmdbId?: string
  /** 剧的分类（按 TMDB 类型：剧集 / 动漫 / 综艺 / 纪录片）；旧版片库服务不给 */
  category?: SeriesCategory
  season: number
  episode: number
  /** 集名；TMDB 没有时为 null。 */
  title: string | null
  /** 播出日期 YYYY-MM-DD（TMDB 给的播出地日期）。 */
  airDate: string
  /** 剧照（TMDB 远程地址）；没有为 null。 */
  still: string | null
  /** 剧的背景图（规则同条目的 backdrop）；没有为 null。 */
  backdrop: string | null
  /** 剧的海报（规则同条目的 poster）；没有为 null。 */
  poster: string | null
  /** 本地这一集的条目 id；库里没有这一集为 null。 */
  itemId: number | null
  /** 本地这一集的第一个视频文件；没有文件为 null。 */
  fileId: number | null
  /** 视频文件路径（桌面端按它取播放进度）；没有文件为 null。 */
  filePath: string | null
}

/** 查询结果。 */
export interface CalendarResult {
  /** 按播出日期、剧名、季集排好序。 */
  episodes: CalendarEpisode[]
  /** 是否配置了 TMDB 令牌；没配置时 episodes 为空。 */
  configured: boolean
  /** 参与查询的剧数。 */
  series: number
  /** 拉取 TMDB 失败、这次没列出来的剧数。 */
  failed: number
}

/** 追剧日历的方法。 */
export interface CalendarRpcMap {
  'calendar.episodes': { params: CalendarRequest; result: CalendarResult }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const CALENDAR_METHODS = [
  'calendar.episodes',
] as const satisfies readonly (keyof CalendarRpcMap)[]

/** window.api.library 上的追剧日历方法。 */
export interface LibraryCalendarBridge {
  calendar: {
    episodes(request: CalendarRequest): Promise<CalendarResult>
  }
}
