export type MediaPlayerOpenOptions = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  /** Resume position in seconds */
  startAt?: number
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
  if (!filePath && !url) return false

  if (!canOpenElectronPlayer()) return false

  try {
    const result = await window.api.player.open({
      ...(filePath ? { filePath } : {}),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(poster ? { poster } : {}),
      ...(typeof startAt === 'number' ? { startAt } : {}),
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