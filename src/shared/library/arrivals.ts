/**
 * 新入库：片库里新出现的电影 / 剧集的某一集（有视频文件、识别过或等够了），引擎 → 主进程。
 *
 * 只给宿主用（推送通知），不经渲染层的 IPC 契约。只有类型和常量。
 */

/** 引擎 → 主进程的事件通道（线协议 event，payload 为 {@link LibraryArrival} 数组）。 */
export const LIBRARY_ARRIVALS = 'library:arrivals'

/** 一条新入库。 */
export interface LibraryArrival {
  /** 电影或集的条目 id。 */
  itemId: number
  libraryId: number
  kind: 'movie' | 'episode'
  /** 顶层条目（电影本身 / 剧）的 id。 */
  topId: number
  /** 电影名 / 剧名（识别过取元数据，没识别取文件名解析结果）。 */
  title: string
  year: number | null
  /** 剧集才有。 */
  season: number | null
  episode: number | null
  /** 集名；没有为 null。 */
  episodeTitle: string | null
  /** 顶层条目是否已匹配到元数据源。 */
  matched: boolean
  /** 第一个视频文件。 */
  filePath: string
  /** 条目入库时间（毫秒）。 */
  addedAt: number
}
