/**
 * 截图 / GIF 渲染层的纯规则：文件名提示、能否截 GIF、失败原因文案。
 * 不碰 DOM，便于单测；接线见 screenshot.ts。
 */

/** 能否截 GIF 的判断结果 */
export interface GifSupport {
  enabled: boolean
  /** 不能用时给用户看的原因 */
  reason: string
}

/**
 * 是否为本地文件（local://）。
 * @param url 实际播放地址
 */
export const isLocalUrl = (url: string): boolean => /^local:\/\//i.test(url)

/**
 * 截图文件名提示：本地文件取文件名（去扩展名），其余返回空串（主进程用默认名）。
 * @param url 实际播放地址
 */
export function nameHint(url: string): string {
  if (!isLocalUrl(url)) return ''
  const path = url.split(/[?#]/)[0] ?? ''
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // 非法转义：按原样取
  }
  const file = decoded.split(/[\\/]/).pop() ?? ''
  return file.replace(/\.[^.]+$/, '')
}

/**
 * 能否截 GIF：只在桌面端、本地文件、找到 ffmpeg 时可用。
 * @param input.desktop 是否桌面端（有 window.api）
 * @param input.local 当前是否本地文件
 * @param input.ffmpeg 主进程是否找到 ffmpeg；还没问到时为 null
 */
export function gifSupport(input: {
  desktop: boolean
  local: boolean
  ffmpeg: boolean | null
}): GifSupport {
  if (!input.desktop) return { enabled: false, reason: '网页版不支持截 GIF' }
  if (!input.local) return { enabled: false, reason: '在线视频只支持截图' }
  if (input.ffmpeg === null)
    return { enabled: false, reason: '正在检测 ffmpeg…' }
  if (!input.ffmpeg) {
    return {
      enabled: false,
      reason:
        '没有找到 ffmpeg，无法生成 GIF（安装 ffmpeg 或设置环境变量 YINGBOX_FFMPEG）',
    }
  }
  return { enabled: true, reason: '' }
}

/** 截帧失败的种类 */
export type FrameFailure = 'not-ready' | 'tainted' | 'unknown'

/**
 * 截帧失败的原因。画布被跨域视频污染时 toBlob / getImageData 抛 SecurityError。
 * @param error 捕获到的错误
 */
export function frameFailure(error: unknown): FrameFailure {
  if (error instanceof Error && error.message === 'not-ready')
    return 'not-ready'
  if (error instanceof Error && error.name === 'SecurityError') return 'tainted'
  return 'unknown'
}

/**
 * 截帧失败给用户看的文案。
 * @param failure 失败种类
 */
export function frameFailureText(failure: FrameFailure): string {
  if (failure === 'not-ready') return '视频还没加载好，稍后再截图'
  if (failure === 'tainted') return '这个视频源有跨域限制，无法截图'
  return '截图失败'
}
