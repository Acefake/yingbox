/**
 * 取缩略图原图（依赖注入，便于测试；接线在 index.ts）：
 * - file:///…：本地图片，直接给路径（nativeImage 读文件）；
 * - 插件登记的协议（如 amane:）：交给插件的处理函数；
 * - http(s)：主进程带 SSRF 防护出网，只给名单里的防盗链 CDN 带 Referer。
 * 响应必须是图片且不超过大小上限。
 */
import { fileURLToPath } from 'node:url'
import type { OriginalImage } from './thumbnailer'

/** 原图大小上限 */
export const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024

/** 取原图的依赖。 */
export interface SourceDeps {
  /** 带 SSRF 防护的 GET，非 2xx 抛错 */
  fetchImage(url: string): Promise<Response>
  /** 按上限读完响应体，超出抛错 */
  readLimited(response: Response, maxBytes: number): Promise<Uint8Array>
  /** 非 http(s) 来源的取图函数，按协议（含冒号）登记 */
  loaders: ReadonlyMap<string, (source: string) => Promise<Response>>
}

/** WebP 文件头：RIFF????WEBP */
export function isWebp(bytes: Uint8Array): boolean {
  const tag = (from: number): string =>
    String.fromCharCode(...bytes.subarray(from, from + 4))
  return bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP'
}

/** 校验响应是图片、不超上限，读出字节。 */
async function readImage(
  response: Response,
  deps: SourceDeps
): Promise<OriginalImage> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers.get('content-type')?.split(';')[0] || ''
  const length = Number(response.headers.get('content-length') || 0)
  if (!type.startsWith('image/') || length > MAX_ORIGINAL_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw new Error(
      type.startsWith('image/') ? '图片超过大小上限' : '响应不是图片'
    )
  }
  return { bytes: await deps.readLimited(response, MAX_ORIGINAL_BYTES) }
}

/** 创建原图读取函数（来源已由 isThumbSource 校验过）。 */
export function createSourceLoader(
  deps: SourceDeps
): (source: string) => Promise<OriginalImage> {
  return async source => {
    const scheme = new URL(source).protocol
    if (scheme === 'file:') return { path: fileURLToPath(source) }
    const loader = deps.loaders.get(scheme)
    if (loader) return readImage(await loader(source), deps)
    if (scheme !== 'http:' && scheme !== 'https:')
      throw new Error(`不支持的来源：${scheme}`)
    return readImage(await deps.fetchImage(source), deps)
  }
}
