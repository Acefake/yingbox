import { getSetting } from '@/features/settings'

/** 播放列表条目：用于自动连播与失败换源 */
export type PlayerSourceItem = {
  url?: string
  filePath?: string
  /** 展示名（集名 / 文件名） */
  name?: string
  /** CatSpider 插件参数 */
  ext?: Record<string, unknown>
  /** CatSpider 站点名 */
  siteName?: string
}

type MediaPlayerOpenOptions = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  /** Resume position in seconds */
  startAt?: number
  /** 自动连播队列（当前线路的剧集） */
  playlist?: PlayerSourceItem[]
  /** 起始项下标 */
  index?: number
  /** 同集备用线路：播放失败时优先尝试 */
  fallbacks?: PlayerSourceItem[]
  /** 播放引擎：'built-in' 为内置 Artplayer 窗口，'mpv' 为 mpv 独立播放器，不传则读取全局设置 */
  engine?: 'built-in' | 'mpv'
}

/** Whether Electron dedicated player window IPC is available. */
export function canOpenElectronPlayer(): boolean {
  return Boolean(typeof window !== 'undefined' && window.api?.player?.open)
}

/**
 * 把 RTX 视频超分开关同步给主进程。
 * 主进程据此决定 mpv 启动参数（d3d11 GPU API / 硬解）与运行时滤镜挂载。
 */
export function syncRtxVsr(): void {
  const api = typeof window !== 'undefined' ? window.api?.mpv : undefined
  if (!api?.setVsr) return
  void api.setVsr(getSetting('player.rtxVsr')).catch(() => {
    /* 非 Electron 或旧版本预加载：静默忽略 */
  })
}

/** 每个会话只提示一次 mpv 回退，避免每次播放都弹 */
let mpvFallbackNotified = false

/**
 * mpv 不可用时（最常见的是系统未安装 mpv）给出一次可见提示。
 * 详细原因（含安装指引）写入控制台，提示本身保持简短。
 */
function notifyMpvFallback(detail?: string): void {
  if (detail)
    console.warn('[openMediaPlayer] mpv 不可用，已改用内置播放器:', detail)
  if (mpvFallbackNotified) return
  mpvFallbackNotified = true
  void import('ant-design-vue')
    .then(({ message }) => {
      message.warning(
        '未检测到 mpv 播放器，已改用内置播放器。可在「设置 → 播放器引擎」切换或安装 mpv。'
      )
    })
    .catch(() => {
      /* 非 UI 环境下静默忽略 */
    })
}

/**
 * Open the shared media player surface.
 * - If engine is 'mpv', launches/controls mpv player
 * - Otherwise: dedicated `player` BrowserWindow via `api.player.open`
 */
export async function openMediaPlayer(
  options: MediaPlayerOpenOptions
): Promise<boolean> {
  const filePath =
    typeof options.filePath === 'string' ? options.filePath.trim() : ''
  const url = typeof options.url === 'string' ? options.url.trim() : ''
  const title = typeof options.title === 'string' ? options.title : undefined
  const poster = typeof options.poster === 'string' ? options.poster.trim() : ''
  const startAt =
    typeof options.startAt === 'number' && Number.isFinite(options.startAt)
      ? Math.max(0, options.startAt)
      : undefined
  const playlist =
    Array.isArray(options.playlist) && options.playlist.length
      ? options.playlist
      : undefined
  const fallbacks =
    Array.isArray(options.fallbacks) && options.fallbacks.length
      ? options.fallbacks
      : undefined
  const index =
    Number.isInteger(options.index) && (options.index as number) >= 0
      ? (options.index as number)
      : undefined

  if (!filePath && !url && !playlist) return false

  const selectedEngine = options.engine || getSetting('player.engine')

  if (
    selectedEngine === 'mpv' &&
    typeof window !== 'undefined' &&
    window.api?.mpv
  ) {
    try {
      // 先同步超分开关，保证首次启动 mpv 时启动参数正确
      syncRtxVsr()
      const res = await window.api.mpv.open({
        ...(filePath ? { filePath } : {}),
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        ...(typeof startAt === 'number' ? { startAt } : {}),
        ...(playlist
          ? {
              playlist: playlist.map(item => ({
                filePath: item.filePath,
                url: item.url,
                name: item.name,
              })),
            }
          : {}),
        ...(typeof index === 'number' ? { index } : {}),
      })
      if (res?.success) return true
      // 主进程以失败结果返回（例如未安装 mpv）：提示并回退
      notifyMpvFallback(res?.error)
    } catch (e) {
      notifyMpvFallback(e instanceof Error ? e.message : String(e))
    }
  }

  if (!canOpenElectronPlayer()) return false

  try {
    const result = await window.api.player.open({
      ...(filePath ? { filePath } : {}),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(poster ? { poster } : {}),
      ...(typeof startAt === 'number' ? { startAt } : {}),
      ...(playlist ? { playlist } : {}),
      ...(typeof index === 'number' ? { index } : {}),
      ...(fallbacks ? { fallbacks } : {}),
    })
    return Boolean(result?.success)
  } catch (error) {
    console.warn('[openMediaPlayer] failed', error)
    return false
  }
}
