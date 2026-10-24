import { call, defineDomain, int, optStr, str } from './define'

/** 弹幕库候选：作品 + 一集（episodeId 即弹幕库编号） */
export interface DanmakuMatch {
  episodeId: number
  animeId: number
  animeTitle: string
  episodeTitle: string
  /** 弹幕偏移秒数（正数 = 弹幕延后出现） */
  shift: number
}

/** 文件识别结果 */
export interface DanmakuMatchResult {
  /** 是否精确关联（hash 命中，列表只有一项） */
  isMatched: boolean
  matches: DanmakuMatch[]
}

/** 搜索结果里的一部作品 */
export interface DanmakuAnime {
  animeId: number
  animeTitle: string
  /** 类型描述（TV动画 / 电影 / 电视剧 …） */
  typeDescription: string
  episodes: { episodeId: number; episodeTitle: string }[]
}

/** 一条弹幕（已整理成播放器格式） */
export interface DanmakuComment {
  /** 出现时间（秒） */
  time: number
  /** 0 滚动 / 1 顶部 / 2 底部 */
  mode: 0 | 1 | 2
  /** #rrggbb */
  color: string
  text: string
}

/** 弹幕接口的统一返回 */
export interface DanmakuReply<T> {
  success: boolean
  data?: T
  error?: string
  /** true 表示没填弹弹play AppId / AppSecret */
  notConfigured?: boolean
}

/** 弹幕：弹弹play 开放接口（文件识别、搜索、取弹幕），请求都在主进程签名发出。 */
export const danmaku = defineDomain('danmaku', {
  /** 本地文件识别：主进程读文件前 16MB 算 MD5，连同文件名、大小交给 /api/v2/match（只接受 local:// URL） */
  match: call<[localUrl: string], DanmakuReply<DanmakuMatchResult>>(a => [
    str(a[0], 'localUrl'),
  ]),
  /** 按作品名（可带集数）搜索弹幕库 */
  search: call<[anime: string, episode?: string], DanmakuReply<DanmakuAnime[]>>(
    a => {
      const anime = str(a[0], 'anime')
      const episode = optStr(a[1], 'episode')
      return episode === undefined ? [anime] : [anime, episode]
    }
  ),
  /** 取一集的全部弹幕（含第三方关联，转简体）；主进程磁盘缓存 7 天 */
  comments: call<[episodeId: number], DanmakuReply<DanmakuComment[]>>(a => [
    int(a[0], 'episodeId'),
  ]),
})
