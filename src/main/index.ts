import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  BrowserWindow,
  Menu,
  app,
  globalShortcut,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.svg?asset'
import { serveLocalMedia } from './local-media'
import { registerPlayerWindowIpc } from './player-window'
import { getConfigPath, getDownloadPath, loadConfig } from './config'
import { startBackend } from './backend-manager'
import { checkForUpdatesOnStartup, registerAppIpc } from './ipc/app-ipc'
import { registerDialogIpc } from './ipc/dialog-ipc'
import { registerFileIpc } from './ipc/file-ipc'
import { registerHttpIpc } from './ipc/http-ipc'
import { registerSubtitleIpc } from './ipc/subtitle-ipc'

Menu.setApplicationMenu(null)

app.commandLine.appendSwitch(
  'enable-features',
  'EnableDrDc,CanvasOopRasterization'
)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: { secure: true, standard: true, stream: true, bypassCSP: true },
  },
])

let mainWindow: BrowserWindow | null = null

function getScreenBasedSize(
  ratio = 0.85,
  minW = 1200,
  minH = 900
): { width: number; height: number } {
  const primary = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = primary.workAreaSize
  const w = Math.min(sw, Math.max(Math.floor(sw * ratio), minW))
  const h = Math.min(sh, Math.max(Math.floor(sh * ratio), minH))
  return { width: w, height: h }
}

function createWindow(): void {
  const { width, height } = getScreenBasedSize(0.85, 1200, 900)
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1200, width),
    minHeight: Math.min(900, height),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // 保留 webSecurity: false：在线页（CMS/豆瓣/TMDB）在渲染层直接跨域请求，
      // 开 CORS 会中断在线搜索；跨域收敛到主进程 http:fetch 代理后再开启。
      webSecurity: false,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    checkForUpdatesOnStartup()
  })

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerDevToolsShortcut(): void {
  // F12 切换 DevTools
  globalShortcut.register('F12', () => {
    mainWindow?.webContents.toggleDevTools()
  })

  // Ctrl+Shift+I (Windows/Linux) 或 Cmd+Opt+I (macOS) 切换 DevTools
  const accelerator =
    process.platform === 'darwin' ? 'Command+Option+I' : 'Control+Shift+I'
  globalShortcut.register(accelerator, () => {
    mainWindow?.webContents.toggleDevTools()
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.yingbox.app')

  // 收紧 CSP（与 src/renderer/index.html 的 meta CSP 对齐）：
  // script 禁 eval/inline，style 允许 inline（Ant Design 运行时样式），
  // 媒体与图片允许任意源（m3u8/mp4/在线封面）+ blob/data，local:// 协议自带 bypassCSP。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; connect-src 'self' https: http: ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'self' blob:; media-src * blob: data:",
    ]
    callback({ responseHeaders: headers })
  })

  // 注册 local:// 协议，允许渲染层流式读取本地文件（用于内置播放器）
  protocol.handle('local', serveLocalMedia)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await loadConfig()

  // IPC 按域注册；窗口与后端生命周期由本文件负责
  registerFileIpc()
  registerHttpIpc()
  registerDialogIpc()
  registerAppIpc(() => mainWindow)
  registerSubtitleIpc()
  registerPlayerWindowIpc()

  startBackend({ configPath: getConfigPath(), downloadPath: getDownloadPath() })

  createWindow()
  registerDevToolsShortcut()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 注销所有快捷键
  globalShortcut.unregisterAll()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
