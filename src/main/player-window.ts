import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'

export type PlayerOpenPayload = {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
}

let playerWindow: BrowserWindow | null = null
let pendingPayload: PlayerOpenPayload | null = null

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
  if (!filePath && !url) return null
  return {
    ...(filePath ? { filePath } : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(poster ? { poster } : {}),
    ...(typeof startAt === 'number' ? { startAt } : {}),
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

export function openPlayerWindow(
  payload: PlayerOpenPayload,
  _mainWindow: BrowserWindow | null
): void {
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
      sandbox: false,
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

export function registerPlayerWindowIpc(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('player:open', (_event, payload: PlayerOpenPayload) => {
    const normalized = normalizePayload(payload)
    if (!normalized) {
      return { success: false, error: 'filePath or url required' }
    }
    try {
      openPlayerWindow(normalized, getMainWindow())
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