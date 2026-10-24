/**
 * 弹弹play 客户端：读设置里的 AppId / AppSecret，按签名模式发请求（走 http-client 的 SSRF 防护），
 * 弹幕内容先查磁盘缓存。没填凭据时返回 notConfigured，渲染层据此提示去设置。
 */
import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuMatchResult,
  DanmakuReply,
} from '../../shared/contract/danmaku'
import { fetchHttp, readLimited } from '../http-client'
import type { CommentCache } from './comment-cache'
import { hashForMatch } from './file-hash'
import {
  DANDAN_API_BASE,
  type DandanCredentials,
  businessError,
  commentUrl,
  commentsError,
  dandanHeaders,
  hasCredentials,
  httpErrorMessage,
  matchRequestBody,
  parseComments,
  parseMatchResponse,
  parseSearchResponse,
  searchEpisodesUrl,
} from './rules'

/** 弹幕响应体上限（热门剧集上万条弹幕） */
const MAX_COMMENT_BYTES = 32 * 1024 * 1024

/** 客户端依赖 */
export interface DanmakuServiceDeps {
  credentials: () => Partial<DandanCredentials>
  cache: CommentCache
}

/** 弹幕服务 */
export interface DanmakuService {
  match(filePath: string): Promise<DanmakuReply<DanmakuMatchResult>>
  search(anime: string, episode?: string): Promise<DanmakuReply<DanmakuAnime[]>>
  comments(episodeId: number): Promise<DanmakuReply<DanmakuComment[]>>
}

const NOT_CONFIGURED = {
  success: false,
  notConfigured: true,
  error: '先在设置 · 弹幕里填写弹弹play AppId 和 AppSecret',
} as const

/** 创建弹幕服务 */
export function createDanmakuService(deps: DanmakuServiceDeps): DanmakuService {
  /** 发一次签名请求并解析 JSON */
  const requestJson = async (
    creds: DandanCredentials,
    url: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; maxBytes?: number } = {}
  ): Promise<unknown> => {
    const headers = dandanHeaders(creds, url, Date.now())
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetchHttp(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const raw = await readLimited(response, init.maxBytes)
    return JSON.parse(raw.toString('utf8')) as unknown
  }

  /** 统一处理凭据检查与异常 */
  const guarded = async <T>(
    run: (creds: DandanCredentials) => Promise<T>
  ): Promise<DanmakuReply<T>> => {
    const creds = deps.credentials()
    if (!hasCredentials(creds)) return { ...NOT_CONFIGURED }
    try {
      return { success: true, data: await run(creds) }
    } catch (error) {
      return {
        success: false,
        error: httpErrorMessage((error as Error).message),
      }
    }
  }

  return {
    match: filePath =>
      guarded(async creds => {
        const { hash, size } = await hashForMatch(filePath)
        const body = await requestJson(
          creds,
          `${DANDAN_API_BASE}/api/v2/match`,
          {
            method: 'POST',
            body: matchRequestBody({ filePath, hash, size }),
          }
        )
        const failure = businessError(body)
        if (failure) throw new Error(failure)
        return parseMatchResponse(body)
      }),

    search: (anime, episode) =>
      guarded(async creds => {
        if (anime.trim().length < 2) throw new Error('作品名至少 2 个字')
        const body = await requestJson(creds, searchEpisodesUrl(anime, episode))
        const failure = businessError(body)
        if (failure) throw new Error(failure)
        return parseSearchResponse(body)
      }),

    comments: async episodeId => {
      if (episodeId <= 0) return { success: false, error: '弹幕库编号不对' }
      const cached = await deps.cache.read(episodeId)
      if (cached) return { success: true, data: cached }
      return guarded(async creds => {
        // 接口会 302 到弹幕加速服务，fetchHttp 逐跳校验后跟随
        const body = await requestJson(creds, commentUrl(episodeId), {
          maxBytes: MAX_COMMENT_BYTES,
        })
        // 只缓存有效响应：业务错误不能被当成空弹幕缓存 7 天
        const failure = commentsError(body)
        if (failure) throw new Error(failure)
        const comments = parseComments(body)
        await deps.cache
          .write(episodeId, comments)
          .catch(error =>
            console.warn('[danmaku] 写弹幕缓存失败', (error as Error).message)
          )
        return comments
      })
    },
  }
}
