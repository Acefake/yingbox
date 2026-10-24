/**
 * 弹弹play 开放接口的纯规则：签名、请求参数、响应整理、缓存过期。
 * 不碰网络与磁盘，便于测试（tests/danmaku.test.ts）。
 *
 * 签名算法见 https://doc.dandanplay.com/open/ 「签名验证模式指南」：
 * X-Signature = base64(sha256(AppId + Timestamp + Path + AppSecret))，Path 不含域名与查询串。
 */
import { createHash } from 'node:crypto'

import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuMatch,
  DanmakuMatchResult,
} from '../../shared/contract/danmaku'

/** 接口地址 */
export const DANDAN_API_BASE = 'https://api.dandanplay.net'
/** 文件识别用的 hash 只取文件前 16MB */
export const MATCH_HASH_BYTES = 16 * 1024 * 1024
/** 弹幕内容缓存 7 天 */
export const COMMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 用户填写的开放平台凭据 */
export interface DandanCredentials {
  appId: string
  appSecret: string
}

/** 凭据是否填全 */
export function hasCredentials(
  creds: Partial<DandanCredentials> | null | undefined
): creds is DandanCredentials {
  return !!creds?.appId?.trim() && !!creds?.appSecret?.trim()
}

/**
 * 计算签名。
 * @param timestamp Unix 秒
 * @param path 以 / 开头的接口路径（不含查询串）
 */
export function dandanSignature(
  appId: string,
  timestamp: number,
  path: string,
  appSecret: string
): string {
  return createHash('sha256')
    .update(`${appId}${timestamp}${path}${appSecret}`)
    .digest('base64')
}

/** 从完整地址取签名用的路径：去掉协议、域名、查询串，统一小写 */
export function signaturePath(url: string): string {
  return new URL(url).pathname.toLowerCase()
}

/**
 * 签名模式的三个请求头。
 * @param nowMs 当前毫秒时间（测试可固定）
 */
export function dandanHeaders(
  creds: DandanCredentials,
  url: string,
  nowMs: number
): Record<string, string> {
  const appId = creds.appId.trim()
  const timestamp = Math.floor(nowMs / 1000)
  return {
    'X-AppId': appId,
    'X-Timestamp': String(timestamp),
    'X-Signature': dandanSignature(
      appId,
      timestamp,
      signaturePath(url),
      creds.appSecret.trim()
    ),
    Accept: 'application/json',
  }
}

/** 文件识别请求体：文件名不含目录与扩展名，hash 为前 16MB 的 MD5 */
export function matchRequestBody(input: {
  filePath: string
  hash: string
  size: number
}): {
  fileName: string
  fileHash: string
  fileSize: number
  matchMode: 'hashAndFileName'
} {
  return {
    fileName: matchFileName(input.filePath),
    fileHash: input.hash.toLowerCase(),
    fileSize: Math.max(0, Math.floor(input.size)),
    matchMode: 'hashAndFileName',
  }
}

/** 文件路径 → 识别用文件名（去目录、去最后一个扩展名） */
export function matchFileName(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** 搜索地址：anime 至少 2 个字符；episode 只接受正整数或 C1/S1/O1 */
export function searchEpisodesUrl(anime: string, episode?: string): string {
  const url = new URL('/api/v2/search/episodes', DANDAN_API_BASE)
  url.searchParams.set('anime', anime.trim())
  const ep = episode?.trim()
  if (ep && /^(?:\d+|[CSO]\d+)$/i.test(ep)) url.searchParams.set('episode', ep)
  return url.toString()
}

/** 取弹幕地址：带第三方关联弹幕，转简体 */
export function commentUrl(episodeId: number): string {
  return `${DANDAN_API_BASE}/api/v2/comment/${episodeId}?withRelated=true&chConvert=1`
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''
const asId = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 0

/** 业务错误：200 响应里 success=false */
export function businessError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return '弹幕服务返回格式不对'
  const data = body as { success?: unknown; errorMessage?: unknown }
  if (data.success === false) return asText(data.errorMessage) || '弹幕服务出错'
  return null
}

/** 整理 /api/v2/match 响应 */
export function parseMatchResponse(body: unknown): DanmakuMatchResult {
  const data = (body ?? {}) as { isMatched?: unknown; matches?: unknown }
  const matches: DanmakuMatch[] = []
  for (const raw of Array.isArray(data.matches) ? data.matches : []) {
    const item = (raw ?? {}) as Record<string, unknown>
    const episodeId = asId(item.episodeId)
    if (!episodeId) continue
    matches.push({
      episodeId,
      animeId: asId(item.animeId),
      animeTitle: asText(item.animeTitle),
      episodeTitle: asText(item.episodeTitle),
      shift:
        typeof item.shift === 'number' && Number.isFinite(item.shift)
          ? item.shift
          : 0,
    })
  }
  return { isMatched: data.isMatched === true && matches.length > 0, matches }
}

/** 整理 /api/v2/search/episodes 响应 */
export function parseSearchResponse(body: unknown): DanmakuAnime[] {
  const data = (body ?? {}) as { animes?: unknown }
  const animes: DanmakuAnime[] = []
  for (const raw of Array.isArray(data.animes) ? data.animes : []) {
    const item = (raw ?? {}) as Record<string, unknown>
    const animeId = asId(item.animeId)
    if (!animeId) continue
    const episodes = (Array.isArray(item.episodes) ? item.episodes : [])
      .map(ep => {
        const e = (ep ?? {}) as Record<string, unknown>
        return {
          episodeId: asId(e.episodeId),
          episodeTitle: asText(e.episodeTitle),
        }
      })
      .filter(ep => ep.episodeId > 0)
    animes.push({
      animeId,
      animeTitle: asText(item.animeTitle),
      typeDescription: asText(item.typeDescription),
      episodes,
    })
  }
  return animes
}

/** 弹弹play 模式 → 播放器模式：1 滚动、4 底部、5 顶部 */
function commentMode(raw: number): 0 | 1 | 2 {
  if (raw === 4) return 2
  if (raw === 5) return 1
  return 0
}

/** 32 位整数颜色（R×65536 + G×256 + B）→ #rrggbb */
export function commentColor(raw: number): string {
  const value = Number.isInteger(raw) && raw >= 0 ? raw & 0xffffff : 0xffffff
  return `#${value.toString(16).padStart(6, '0')}`
}

/**
 * 整理 /api/v2/comment 响应：p = "出现时间,模式,颜色,用户ID"，m = 内容。
 * 丢弃空内容与时间不合法的条目，按时间排序。
 */
export function parseComments(body: unknown): DanmakuComment[] {
  const data = (body ?? {}) as { comments?: unknown }
  const list: DanmakuComment[] = []
  for (const raw of Array.isArray(data.comments) ? data.comments : []) {
    const item = (raw ?? {}) as { p?: unknown; m?: unknown }
    const text = asText(item.m)
    if (!text || typeof item.p !== 'string') continue
    const [time, mode, color] = item.p.split(',')
    const seconds = Number(time)
    if (!Number.isFinite(seconds) || seconds < 0) continue
    list.push({
      time: seconds,
      mode: commentMode(Number(mode)),
      color: commentColor(Number(color)),
      text,
    })
  }
  return list.sort((a, b) => a.time - b.time)
}

/** 缓存是否还新鲜 */
export function isCacheFresh(
  savedAt: unknown,
  nowMs: number,
  ttlMs = COMMENT_CACHE_TTL_MS
): boolean {
  return (
    typeof savedAt === 'number' &&
    Number.isFinite(savedAt) &&
    savedAt <= nowMs &&
    nowMs - savedAt < ttlMs
  )
}

/** HTTP 错误 → 给用户看的提示（403 多半是凭据或签名问题） */
export function httpErrorMessage(message: string): string {
  if (/HTTP 403/.test(message))
    return '弹弹play 拒绝了请求，请检查设置里的 AppId / AppSecret 和系统时间'
  if (/HTTP 401/.test(message)) return '弹弹play 要求登录，接口暂不可用'
  return message
}
