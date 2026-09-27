import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'

/** 播放列表条目：用于自动连播与失败跳过 */
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

export type PlayerOpenPayload = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
  /** 播放队列；配合 index 决定起始项 */
  playlist?: PlayerSourceItem[]
  /** 起始项下标 */
  index?: number
  /** 同集备用线路：播放失败时优先尝试 */
  fallbacks?: PlayerSourceItem[]
}

/** 队列长度上限，避免渲染层发送超大数组 */
const MAX_PLAYLIST = 500

let playerWindow: BrowserWindow | null = null
let pendingPayload: PlayerOpenPayload | null = null

/** 规范化单个队列条目，非法条目返回 null */
function normalizeSourceItem(raw: unknown): PlayerSourceItem | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const url = typeof rec.url === 'string' ? rec.url.trim() : ''
  const filePath = typeof rec.filePath === 'string' ? rec.filePath.trim() : ''
  if (!url && !filePath) return null
  const name = typeof rec.name === 'string' ? rec.name : undefined
  const siteName = typeof rec.siteName === 'string' ? rec.siteName : undefined
  const ext =
    rec.ext && typeof rec.ext === 'object' ? (rec.ext as Record<string, unknown>) : undefined
  return {
    ...(url ? { url } : {}),
    ...(filePath ? { filePath } : {}),
    ...(name ? { name } : {}),
    ...(siteName ? { siteName } : {}),
    ...(ext ? { ext } : {}),
  }
}

function normalizePayload(payload: PlayerOpenPayload | null | undefined): PlayerOpenPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const filePath = typeof payload.filePath === 'string' ? payload.filePath.trim() : ''
  const url = typeof payload.url === 'string' ? payload.url.trim() : ''
  const title = typeof payload.title === 'string' ? payload.title : undefined
  const poster = typeof payload.poster === 'string' ? payload.poster.trim() : ''
  const startAt =
    typeof payload.startAt === 'number' && Number.isFinite(payload.startAt)
      ? Math.max(0, payload.startAt)
      : undefined

  const playlist = Array.isArray(payload.playlist)
    ? payload.playlist
        .slice(0, MAX_PLAYLIST)
        .map(normalizeSourceItem)
        .filter((item): item is PlayerSourceItem => item !== null)
    : undefined
  const rawIndex = Number(payload.index)
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0

  // 允许只给队列（首项即播放目标）
  const first = playlist?.[index]
  const effectiveFilePath = filePath || (!url ? first?.filePath || '' : '')
  const effectiveUrl = url || (!filePath ? first?.url || '' : '')
  if (!effectiveFilePath && !effectiveUrl) return null

  return {
    ...(effectiveFilePath ? { filePath: effectiveFilePath } : {}),
    ...(effectiveUrl ? { url: effectiveUrl } : {}),
    ...(title ? { title } : {}),
    ...(poster ? { poster } : {}),
    ...(typeof startAt === 'number' ? { startAt } : {}),
    ...(playlist?.length ? { playlist } : {}),
    ...(playlist?.length ? { index: Math.min(index, playlist.length - 1) } : {}),
  }
}

function buildPlayerHash(payload: PlayerOpenPayload): string {
  // Keep hash short: poster stays on IPC pending only (URLs can be huge)
  const q = new URLSearchParams()
  if (payload.url) q.set('url', payload.url)
  if (payload.filePath) q.set('filePath', payload.filePath)
  if (payload.title) q.set('title', payload.title)
  if (typeof payload.startAt === 'number' && payload.startAt > 0) {
    q.set('startAt', String(Math.floor(payload.startAt)))
  }
  const qs = q.toString()
  return qs ? `player-popout?${qs}` : 'player-popout'
}

function windowTitle(payload: PlayerOpenPayload): string {
  const t = typeof payload.title === 'string' ? payload.title.trim() : ''
  return t ? `影盒 - ${t}` : '影盒 - 正在播放'
}

function applyWindowTitle(payload: PlayerOpenPayload): void {
  if (!playerWindow || playerWindow.isDestroyed()) return
  try {
    playerWindow.setTitle(windowTitle(payload))
  } catch {
    // ignore
  }
}

function sendLoad(payload: PlayerOpenPayload): void {
  if (!playerWindow || playerWindow.isDestroyed()) return
  applyWindowTitle(payload)
  playerWindow.webContents.send('player:load', payload)
}

export function openPlayerWindow(payload: PlayerOpenPayload): void {
  pendingPayload = payload
  const hash = buildPlayerHash(payload)

  if (playerWindow && !playerWindow.isDestroyed()) {
    if (playerWindow.isMinimized()) playerWindow.restore()
    playerWindow.focus()
    sendLoad(payload)
    try {
      const current = playerWindow.webContents.getURL()
      if (current.includes('#')) {
        const base = current.split('#')[0]
        playerWindow.loadURL(`${base}#/${hash}`)
      }
    } catch {
      // ignore
    }
    return
  }

  playerWindow = new BrowserWindow({
    width: 960,
    height: 600,
    minWidth: 640,
    minHeight: 360,
    show: false,
    frame: true,
    title: windowTitle(payload),
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // 与主窗一致：在线直链播放需要跨域，webSecurity 暂保留关闭。
      webSecurity: false,
    },
  })

  playerWindow.on('closed', () => {
    playerWindow = null
    pendingPayload = null
  })

  const deliverPending = (): void => {
    if (pendingPayload) sendLoad(pendingPayload)
  }

  playerWindow.once('ready-to-show', () => {
    playerWindow?.show()
    deliverPending()
  })

  playerWindow.webContents.on('did-finish-load', () => {
    deliverPending()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    playerWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/${hash}`)
  } else {
    playerWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash,
    })
  }
}

export function closePlayerWindow(): void {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.close()
  }
  playerWindow = null
  pendingPayload = null
}

export function registerPlayerWindowIpc(): void {
  ipcMain.handle('player:open', (_event, payload: PlayerOpenPayload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) {
      return { success: false, error: 'filePath or url required' }
    }
    try {
      openPlayerWindow(normalized)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('player:close', () => {
    closePlayerWindow()
    return { success: true }
  })

  ipcMain.handle('player:getPending', () => pendingPayload)
}