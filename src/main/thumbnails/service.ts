/**
 * thumb:// 协议与 thumbs.put 的处理逻辑（依赖注入，便于测试；接线在 index.ts）。
 *
 * - 命中：返回缓存的 WebP（x-thumb: hit）。
 * - 未命中：代取原图原样返回（x-thumb: miss），渲染层 Worker 据此生成 WebP 再 put 回来。
 *   <img> 与 Worker 几乎同时请求同一张原图，所以原图下载按来源去重，并在内存里留最近几张，
 *   保证一张原图只下载一次。
 */
import {
  type ThumbWidth,
  isThumbSource,
  isWebp,
  parseThumbUrl,
} from '../../shared/thumbs'
import { thumbKey } from './cache'

export interface Original {
  data: Uint8Array
  type: string
}

export interface ThumbServiceDeps {
  cache: {
    get(name: string): Promise<Uint8Array | null>
    put(name: string, data: Uint8Array): Promise<void>
  }
  /** 取原图（http(s) 走 SSRF 防护，amane:// 走插件） */
  loadOriginal(source: string): Promise<Original>
  /** 内存里保留几张最近的原图 */
  recentLimit?: number
}

export interface ThumbService {
  respond(url: string): Promise<Response>
  put(source: string, width: ThumbWidth, data: Uint8Array): Promise<boolean>
}

/** Worker 从应用页面跨源 fetch thumb://，要放行并暴露 x-thumb */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Thumb',
}

export function createThumbService(deps: ThumbServiceDeps): ThumbService {
  const recentLimit = deps.recentLimit ?? 24
  const inflight = new Map<string, Promise<Original>>()
  const recent = new Map<string, Original>()

  function remember(source: string, original: Original): void {
    recent.delete(source)
    recent.set(source, original)
    while (recent.size > recentLimit)
      recent.delete(recent.keys().next().value as string)
  }

  function original(source: string): Promise<Original> {
    const cached = recent.get(source)
    if (cached) return Promise.resolve(cached)
    let pending = inflight.get(source)
    if (!pending) {
      pending = deps
        .loadOriginal(source)
        .then(result => {
          remember(source, result)
          return result
        })
        .finally(() => inflight.delete(source))
      inflight.set(source, pending)
    }
    return pending
  }

  return {
    async respond(url) {
      const parsed = parseThumbUrl(url)
      if (!parsed) return new Response(null, { status: 400, headers: CORS })
      const hit = await deps.cache.get(thumbKey(parsed.source, parsed.width))
      if (hit)
        return new Response(hit, {
          headers: { ...CORS, 'Content-Type': 'image/webp', 'X-Thumb': 'hit' },
        })
      try {
        const { data, type } = await original(parsed.source)
        return new Response(data, {
          headers: { ...CORS, 'Content-Type': type, 'X-Thumb': 'miss' },
        })
      } catch {
        return new Response(null, { status: 502, headers: CORS })
      }
    },

    async put(source, width, data) {
      if (!isThumbSource(source) || !isWebp(data)) return false
      await deps.cache.put(thumbKey(source, width), data)
      // 缩略图已落盘，原图不用再留在内存
      recent.delete(source)
      return true
    },
  }
}
