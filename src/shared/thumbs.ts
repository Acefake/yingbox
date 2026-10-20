/**
 * 缩略图（非影视海报 / 封面）两端共用的规则：尺寸档位、thumb:// 地址的拼与解。
 *
 * 流程：<img> 直接加载 `thumb://img/?src=原图&w=档位`。主进程命中磁盘缓存返回 WebP，
 * 未命中就代取原图返回（响应头 x-thumb: miss）；渲染层 Worker 拿同一个地址，
 * 未命中时用 createImageBitmap + OffscreenCanvas 缩成 WebP，经 thumbs.put 交给主进程落盘。
 */

/** 允许的宽度档位（px）；主进程只认这些，防止任意尺寸把缓存撑爆 */
export const THUMB_WIDTHS = [240, 360, 480, 720] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

/** 单张缩略图大小上限（WebP 720px 宽通常 < 150 KB） */
export const MAX_THUMB_BYTES = 2 * 1024 * 1024

/** 原图来源：http(s) 或 amane://（Amane 资源图） */
export function isThumbSource(source: string): boolean {
  return /^(https?:\/\/|amane:\/\/image\/)/i.test(source)
}

/** 取不小于 cssWidth × dpr 的最小档位（超出最大档用最大档） */
export function pickThumbWidth(cssWidth: number, dpr = 1): ThumbWidth {
  const need = Math.ceil(cssWidth * Math.max(1, dpr))
  return THUMB_WIDTHS.find(w => w >= need) ?? THUMB_WIDTHS.at(-1)!
}

/** 拼 thumb:// 地址；来源不支持时返回 null */
export function thumbUrl(source: string, width: ThumbWidth): string | null {
  if (!isThumbSource(source)) return null
  return `thumb://img/?w=${width}&src=${encodeURIComponent(source)}`
}

/** 解析 thumb:// 地址；不合法返回 null */
export function parseThumbUrl(
  url: string
): { source: string; width: ThumbWidth } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'thumb:') return null
    const source = parsed.searchParams.get('src') || ''
    const width = Number(parsed.searchParams.get('w'))
    if (!isThumbSource(source)) return null
    if (!THUMB_WIDTHS.includes(width as ThumbWidth)) return null
    return { source, width: width as ThumbWidth }
  } catch {
    return null
  }
}

/** 按宽度等比缩放；原图比目标窄时不放大 */
export function fitWidth(
  width: number,
  height: number,
  maxWidth: number
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height }
  return {
    width: maxWidth,
    height: Math.max(1, Math.round((height * maxWidth) / width)),
  }
}

/** WebP 文件头：RIFF????WEBP */
export function isWebp(bytes: Uint8Array): boolean {
  const tag = (from: number): string =>
    String.fromCharCode(...bytes.subarray(from, from + 4))
  return bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP'
}
