/**
 * 识别执行器的类型：依赖、执行模式、批量统计，以及拆出去的电影 / 剧集 / 手动匹配流程共用的上下文。
 */
import type { IdentifyResult } from '../../../shared/library/identify'
import type { MediaMetadata, MediaRef } from '../../../shared/library/provider'
import type { ScoredCandidate } from '../../../shared/library/scoring'
import type { ItemChanges } from '../catalog/catalog-store'
import type { LibraryDb } from '../db/database'
import type { ImageCache } from '../images/image-cache'
import type { OpenSubtitlesHashLookup } from '../providers/opensubtitles/os-hash-lookup'
import type { TmdbProvider } from '../providers/tmdb/tmdb-provider'
import type { IdentifyStore, IdentifyTarget } from './identify-store'
import type { MetadataWriter } from './metadata-writer'

/** 执行器依赖。 */
export interface IdentifyRunnerDeps {
  db: LibraryDb
  store: IdentifyStore
  writer: MetadataWriter
  provider: TmdbProvider
  hashLookup?: OpenSubtitlesHashLookup
  images?: ImageCache
  /** 读 NFO 文本；读不到返回 undefined。 */
  readText?: (path: string) => Promise<string | undefined>
  /** 探测视频时长（秒）。 */
  probeDuration?: (path: string) => Promise<number | undefined>
  /** 计算 OpenSubtitles moviehash（文件还没有指纹时）。 */
  fingerprint?: (path: string) => Promise<string | undefined>
  now?: () => number
  log?: (message: string) => void
}

/** 一次批量执行的统计。 */
export interface RunSummary {
  total: number
  done: number
  matched: number
  review: number
  unmatched: number
  failed: number
  /** 顶层条目变化（推送 items-changed 用）。 */
  changes: ItemChanges
}

/** 执行模式：identify 识别（已自动匹配的只补季 / 集）；force 全部重识别；refresh 只刷新元数据。 */
export type RunMode = 'identify' | 'force' | 'refresh'

/** 单个条目的结果。 */
export type Outcome = 'matched' | 'review' | 'unmatched' | 'skipped'

/**
 * 电影 / 剧集 / 手动匹配流程需要的执行器能力（由 IdentifyRunner 实现）。
 * 写入统一走 applyRef / writeUndecided，保证事务边界和以前一样。
 */
export interface RunnerContext {
  readonly deps: IdentifyRunnerDeps
  readText(path: string): Promise<string | undefined>
  now(): number
  /** 应用一个确定的匹配（取元数据、写条目与季集、缓存图片）。 */
  applyRef(
    target: IdentifyTarget,
    ref: MediaRef,
    state: 'auto' | 'locked',
    result: IdentifyResult | undefined,
    changes: ItemChanges,
    signal?: AbortSignal
  ): Promise<MediaMetadata>
  /** 写入待确认 / 未匹配状态与候选，清掉旧元数据。 */
  writeUndecided(
    target: IdentifyTarget,
    candidates: ScoredCandidate[],
    changes: ItemChanges,
    state?: 'review' | 'unmatched'
  ): Outcome
}
