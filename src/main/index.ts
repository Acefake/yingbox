import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  BrowserWindow,
  Menu,
  app,
  globalShortcut,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { join } from 'path'
import { lookup } from 'node:dns/promises'
import { createNetClient } from '../shared/net/client'
import { STREAM_SCHEME } from '../shared/stream-url'
import { createStreamHandler } from './stream-proxy'
import { installWindowSecurity } from './window-security'
import icon from '../../resources/icon.svg?asset'
import { serveLocalMedia } from './local-media'
import { installPluginHost } from './plugins/host'
import { checkForUpdatesOnStartup, registerAppIpc } from './ipc/app-ipc'
import { registerDialogIpc } from './ipc/dialog-ipc'
import { registerCaptureIpc } from './capture'
import { registerSubtitleIpc } from './ipc/subtitle-ipc'
import { MEDIA_SCHEME_PRIVILEGES, registerThumbnails } from './thumbnails'
import { registerMpvIpc } from './ipc/mpv-ipc'
import { registerLadaIpc } from './ipc/lada-ipc'
import { registerLibraryIpc } from './library/host'
import { registerLibraryNotify } from './library/notify'
import { registerEngine } from './engine'
import { blockPlaceholderImages, installMediaHeaders } from './media-headers'
import { initSettings, onSecretSaved, settingsStore } from './settings'
import { TMDB_SECRET, libraryTokenTarget, syncTmdbTokenToLibrary } from './tmdb'

/**
 * 固定 userData 目录（必须在 ready 之前、且在任何 app.getPath('userData') 之前）。
 *
 * `electron-vite preview` 以 `out/main/index.js` 作为入口启动 Electron 时，app name
 * 会退化成 "Electron"，userData 随之变成 %APPDATA%\Electron —— 渲染层的 localStorage
 * 就是一个全新的空桶：刚改的设置“消失”，切回 `pnpm dev` 又“恢复”成旧的。
 * 开发/预览统一钉到 yingbox；打包版仍走 productName（影盒）的目录，不动已安装用户的数据。
 */
if (is.dev) app.setPath('userData', join(app.getPath('appData'), 'yingbox'))

Menu.setApplicationMenu(null)

app.commandLine.appendSwitch(
  'enable-features',
  'EnableDrDc,CanvasOopRasterization'
)
// Shape Detection 的 FaceDetector（海报人脸取景，见 renderer/services/thumbnails/focus.ts）：
// 只开这一项，不开 enable-experimental-web-platform-features。Windows / macOS 有系统实现，Linux 会报 NotSupportedError
app.commandLine.appendSwitch('enable-blink-features', 'FaceDetector')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: { secure: true, standard: true, stream: true, bypassCSP: true },
  },
  // 缓存图片与缩略图（媒体库海报、在线 / AV 封面），见 src/main/thumbnails
  MEDIA_SCHEME_PRIVILEGES,
  {
    scheme: STREAM_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
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
      webSecurity: true,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    checkForUpdatesOnStartup()
  })

  installWindowSecurity(mainWindow.webContents, url => shell.openExternal(url))

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
  // script 禁 eval/inline，style 允许 inline（开发时 Vite 注入的 <style>、组件的动态样式），
  // 媒体与图片允许任意源（m3u8/mp4/在线封面）+ blob/data，local:// 协议自带 bypassCSP。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: yingbox-media: data: blob:; connect-src 'self' https: http: ws: wss: yingbox-stream:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'self' blob:; media-src * blob: data:",
    ]
    callback({ responseHeaders: headers })
  })

  // MissAV 视频分片与封面需要 Referer，渲染层直连时由这里注入
  installMediaHeaders(session.defaultSession)
  // 图床缺图时的占位图不显示（剧照等远程图直接走加载失败）
  blockPlaceholderImages(session.defaultSession)

  // 注册 local:// 协议，允许渲染层流式读取本地文件（用于内置播放器）
  protocol.handle('local', serveLocalMedia)
  protocol.handle(
    STREAM_SCHEME,
    createStreamHandler(
      createNetClient({
        fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' }),
        lookup: host => lookup(host, { all: true }),
      })
    )
  )

  // 注册 yingbox-media:// 协议（全应用的缓存图片与 WebP 缩略图）
  const thumbnails = registerThumbnails()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await initSettings()

  // IPC 按域注册；窗口生命周期由本文件负责
  registerDialogIpc()
  registerAppIpc(() => mainWindow)
  registerSubtitleIpc()
  registerCaptureIpc()
  registerMpvIpc()
  await registerLadaIpc()
  const libraryClient = registerLibraryIpc(thumbnails)
  const library = libraryTokenTarget(libraryClient)
  // 网盘文件变更通知（CloudDrive2 webhook 等）→ 媒体库按目录增量扫描
  registerLibraryNotify(libraryClient)
  // TMDB 令牌：用户改了就下发给媒体库引擎；启动时补给还没配置的引擎（老用户迁移来的令牌）
  onSecretSaved(async (key, value) => {
    if (key === TMDB_SECRET)
      await library.setProviderToken(value.trim() || null)
  })
  void syncTmdbTokenToLibrary(
    library,
    settingsStore().getSecret(TMDB_SECRET)
  ).catch(error =>
    console.warn('[tmdb] 同步令牌到媒体库引擎失败', (error as Error).message)
  )
  registerEngine()
  // lada / mpv 都按需启动；退出时由插件宿主统一停止并等进程退出
  installPluginHost(app)

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
