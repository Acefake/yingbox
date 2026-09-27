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

export type MediaPlayerOpenOptions = {
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
}

/** Whether Electron dedicated player window IPC is available. */
export function canOpenElectronPlayer(): boolean {
  return Boolean(typeof window !== 'undefined' && window.api?.player?.open)
}

/**
 * Open the shared media player surface.
 * - Electron: dedicated `player` BrowserWindow via `api.player.open`
 * - Otherwise: returns false so callers can fall back to in-page overlay
 */
export async function openMediaPlayer(
  options: MediaPlayerOpenOptions
): Promise<boolean> {
  const filePath = typeof options.filePath === 'string' ? options.filePath.trim() : ''
  const url = typeof options.url === 'string' ? options.url.trim() : ''
  const title = typeof options.title === 'string' ? options.title : undefined
  const poster = typeof options.poster === 'string' ? options.poster.trim() : ''
  const startAt =
    typeof options.startAt === 'number' && Number.isFinite(options.startAt)
      ? Math.max(0, options.startAt)
      : undefined
  const playlist =
    Array.isArray(options.playlist) && options.playlist.length ? options.playlist : undefined
  const fallbacks =
    Array.isArray(options.fallbacks) && options.fallbacks.length ? options.fallbacks : undefined
  const index =
    Number.isInteger(options.index) && (options.index as number) >= 0
      ? (options.index as number)
      : undefined

  if (!filePath && !url && !playlist) return false

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

export function useMediaPlayer() {
  return {
    canOpenElectronPlayer,
    openMediaPlayer,
  }
}