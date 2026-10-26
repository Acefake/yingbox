/**
 * m3u8 改写（纯函数）：把清单里的每个地址换成经服务代理的地址，分片、密钥、子清单、初始化段都走 /api/stream。
 *
 * 桌面端不需要它：hls.js 的自定义加载器逐个请求都走 yingbox-stream://。网页端要照顾不经 hls.js 的播放器
 * （iOS Safari 原生 HLS 直接读清单里的地址），所以在服务端改清单。
 * - 地址行（非 # 开头）与标签里的 URI="…"（EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA / EXT-X-I-FRAME-STREAM-INF …）都改；
 * - 相对地址按清单的最终地址（跟随重定向后）解析成绝对地址；
 * - 只改 http(s) 地址，data: / skd: 等原样保留。
 */

/** 正文是否是 m3u8（容忍 BOM 与前导空白）。 */
export function looksLikePlaylist(text: string): boolean {
  return /^\uFEFF?\s*#EXTM3U/.test(text)
}

/**
 * 响应是否值得嗅探正文：音视频、图片类型肯定不是清单，其余（mpegurl、text/plain、octet-stream、没写类型）
 * 都可能是——不少源用奇怪的类型和不带 .m3u8 的地址发清单。
 */
export function mayBePlaylist(contentType: string): boolean {
  if (/mpegurl/i.test(contentType)) return true
  return !/^\s*(video|audio|image)\//i.test(contentType)
}

/** 改写清单；wrap 把绝对地址变成代理地址。 */
export function rewritePlaylist(
  text: string,
  baseUrl: string,
  wrap: (absolute: string) => string
): string {
  const resolveRef = (ref: string): string => {
    let absolute: URL
    try {
      absolute = new URL(ref, baseUrl)
    } catch {
      return ref
    }
    return ['http:', 'https:'].includes(absolute.protocol)
      ? wrap(absolute.href)
      : ref
  }
  return text
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#'))
        return line.replace(
          /URI="([^"]*)"/g,
          (_all, ref: string) => `URI="${resolveRef(ref)}"`
        )
      return resolveRef(trimmed)
    })
    .join('\n')
}
