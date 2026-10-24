/**
 * 前情提要 / 问剧情的共享类型：主进程（src/main/recap）、IPC 契约（contract/recap）与
 * 渲染层（features/player/recap）共用。本文件被 sandboxed preload 间接打包，只能是纯 TS。
 */

/** 一集的素材来自哪里：字幕台词，或分集简介（本地 NFO / TMDB） */
export type RecapSourceKind = 'subtitle' | 'overview'

/** 一集的标识 */
export interface RecapEpisodeRef {
  /** 显示名，如「S01E03」「第 3 集」 */
  label: string
  /** 季号；文件名没写时缺省 */
  season?: number
  /** 集号 */
  episode: number
}

/** 开播时的轻量探测结果（不调用模型） */
export interface RecapProbe {
  /** 剧名（从文件名解析；解析不出时为空串） */
  show: string
  /** 当前集；不是剧集（电影、无法识别集号）时为 null */
  episode: RecapEpisodeRef | null
  /** 有素材可用的之前几集（旧 → 新，最多 3 集） */
  previous: RecapEpisodeRef[]
  /** 这次前情提要的缓存键（随之前各集素材变化） */
  cacheKey: string
  /** 已缓存的前情提要；没有时为 null */
  cached: string | null
}

/** 之前某一集的摘要 */
export interface RecapEpisodeSummary extends RecapEpisodeRef {
  /** 摘要正文（中文） */
  text: string
  source: RecapSourceKind
}

/** 本集已播部分（问剧情用，严格截断在当前进度之前） */
export interface RecapCurrentPart {
  /** 截断位置（秒） */
  seconds: number
  /** 已播部分前面整段台词的分段摘要（旧 → 新） */
  summaries: string[]
  /** 进度之前最近的原始台词（每条一行） */
  recent: string
  /** 本集有没有可用字幕（没有时只能用之前各集摘要） */
  hasSubtitle: boolean
}

/** 生成前情提要 / 回答问题用的上下文 */
export interface RecapContext {
  show: string
  episode: RecapEpisodeRef | null
  /** 之前各集摘要（旧 → 新） */
  previous: RecapEpisodeSummary[]
  /** 本集已播部分（只有问剧情才有） */
  current?: RecapCurrentPart
  /** 前情提要缓存键（同 probe） */
  cacheKey: string
}

/** 用途：前情提要 / 问剧情 */
export type RecapPurpose = 'recap' | 'qa'

/** recap.probe 的选项 */
export interface RecapProbeOptions {
  /** 来自私密板块：不联网查 TMDB，缓存只放内存 */
  private?: boolean
}

/** recap.prepare 的选项 */
export interface RecapPrepareOptions extends RecapProbeOptions {
  purpose: RecapPurpose
  /** 问剧情：当前播放进度（秒），本集只取这之前的台词 */
  seconds?: number
}

/** recap.save 的参数：生成完的前情提要按集缓存 */
export interface RecapSaveOptions extends RecapProbeOptions {
  cacheKey: string
  text: string
}
