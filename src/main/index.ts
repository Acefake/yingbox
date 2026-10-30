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
import { STREAM_SCHEME } from '../shared/stream-url'
import { createStreamHandler } from './stream-proxy'
import { streamNetClient } from './stream-net'
import { installWindowSecurity } from './window-security'
import { installPermissionPolicy } from './permissions'
import { installSingleInstance } from './single-instance'
import { installDevToolsShortcut } from './devtools-shortcut'
import icon from '../../resources/icon.svg?asset'
import { serveLocalMedia } from './local-media'
import { installPluginHost } from './plugins/host'
import { checkForUpdatesOnStartup, registerAppIpc } from './ipc/app-ipc'
import { registerDialogIpc } from './ipc/dialog-ipc'
import { registerIptvIpc } from './ipc/iptv-ipc'
import { registerCaptureIpc } from './capture'
import { registerSubtitleIpc } from './ipc/subtitle-ipc'
import { registerDanmakuIpc } from './ipc/danmaku-ipc'
import { MEDIA_SCHEME_PRIVILEGES, registerThumbnails } from './thumbnails'
import { registerMpvIpc } from './ipc/mpv-ipc'
import { registerLadaIpc } from './ipc/lada-ipc'
import { registerIntroDetectIpc } from './intro-detect'
import { registerDolbyVisionIpc } from './dolby-vision'
import { registerLibraryIpc } from './library/host'
import { registerLibraryNotify } from './library/notify'
import { registerProgressSync } from './library/progress-sync'
import {
  REMOTE_SCHEME_PRIVILEGES,
  registerWebDav,
  webdavHostMethods,
} from './webdav'
import { registerEngine } from './engine'
import { blockPlaceholderImages, installMediaHeaders } from './media-headers'
import { initSettings, onSecretSaved, settingsStore } from './settings'
import { registerAi } from './ai'
import { registerPan115 } from './pan115'
import { desktopModuleHost } from './module-host/desktop'
import { registerAutograb } from './autograb'
import { registerNotify } from './notify'
import { registerAutograbMovies } from './autograb/movies'
import { createPanAdapter } from './autograb/upgrade/pan-adapter'
import { registerAutograbUpgrade } from './autograb/upgrade'
import { registerDiscover } from './discover'
import { registerOffline } from './offline'
import { registerAiSubtitles } from './ai-subtitles'
import { registerRecap } from './recap'
import { TMDB_SECRET, libraryTokenTarget, syncTmdbTokenToLibrary } from './tmdb'
import { registerScrapePrefsSync } from './scrape-prefs'
import { installTray } from './tray'
import { registerAssistant } from './assistant'
import { type PlayerWindowControl, registerPlayerWindow } from './player-window'

/**
 * 固定 userData 目录（必须在 ready 之前、且在任何 app.getPath('userData') 之前）。
 *
 * `electron-vite preview` 以 `out/main/index.js` 作为入口启动 Electron 时，app name
 * 会退化成 "Electron"，userData 随之变成 %APPDATA%\Electron —— 渲染层的 localStorage
 * 就是一个全新的空桶：刚改的设置“消失”，切回 `pnpm dev` 又“恢复”成旧的。
 * 开发/预览统一钉到 yingbox；打包版仍走 productName（影盒）的目录，不动已安装用户的数据。
 */
if (is.dev) app.setPath('userData', join(app.getPath('appData'), 'yingbox'))
installSingleInstance(app, () => {
  void startup.then(showMainWindow)
})

Menu.setApplicationMenu(null)

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
  // WebDAV / Alist 远程媒体（主进程带凭据转发，支持 Range），见 src/main/webdav
  REMOTE_SCHEME_PRIVILEGES,
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
let playerWindow: PlayerWindowControl | null = null

/** 启动时的固定窗口尺寸（逻辑像素）；屏幕放不下时缩到工作区大小 */
const START_SIZE = { width: 1440, height: 900 }

function getStartSize(): { width: number; height: number } {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.min(sw, START_SIZE.width),
    height: Math.min(sh, START_SIZE.height),
  }
}

function createWindow(): void {
  const { width, height } = getStartSize()
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1200, width),
    minHeight: Math.min(900, height),
    center: true,
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

  // 播放器窗口跟着主窗口关（macOS 关主窗口不退出，也不留一个孤零零的播放器）
  mainWindow.on('close', () => playerWindow?.close())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    checkForUpdatesOnStartup()
  })

  installWindowSecurity(mainWindow.webContents, url => shell.openExternal(url))
  // F12 / Ctrl+Shift+I 只在主窗口聚焦时切 DevTools（不注册系统级快捷键，不抢别的程序的按键）
  installDevToolsShortcut(mainWindow.webContents, {
    platform: process.platform,
    dev: is.dev,
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 显示并聚焦主窗口（托盘菜单「显示主窗口」）；已关闭时重新创建 */
function showMainWindow(): void {
  if (!mainWindow) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const startup = app.whenReady().then(async () => {
  installPermissionPolicy(session.defaultSession)
  electronApp.setAppUserModelId('com.yingbox.app')

  // 收紧 CSP（与 src/renderer/index.html 的 meta CSP 对齐）：
  // script 禁 eval/inline，style 允许 inline（开发时 Vite 注入的 <style>、组件的动态样式），
  // 媒体与图片允许任意源（m3u8/mp4/在线封面）+ blob/data，local:// 协议自带 bypassCSP。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: yingbox-media: data: blob:; connect-src 'self' https: http: ws: wss: yingbox-stream: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'self' blob:; media-src * blob: data: yingbox-stream:",
    ]
    callback({ responseHeaders: headers })
  })

  // 媒体防盗链 Referer 在渲染层直连时由这里注入
  installMediaHeaders(session.defaultSession)
  // 图床缺图时的占位图不显示（剧照等远程图直接走加载失败）
  blockPlaceholderImages(session.defaultSession)

  // 注册 local:// 协议，允许渲染层流式读取本地文件（用于内置播放器）
  protocol.handle('local', serveLocalMedia)
  protocol.handle(STREAM_SCHEME, createStreamHandler(streamNetClient()))

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
  registerIptvIpc()
  registerCaptureIpc()
  registerDanmakuIpc()
  registerMpvIpc()
  await registerLadaIpc()
  // WebDAV / Alist 源：设置、yingbox-dav 播放协议、媒体库引擎扫描时取凭据
  registerWebDav()
  const libraryClient = registerLibraryIpc(thumbnails, webdavHostMethods)
  registerIntroDetectIpc()
  registerDolbyVisionIpc()
  const library = libraryTokenTarget(libraryClient)
  // 网盘文件变更通知（CloudDrive2 webhook 等）→ 媒体库按目录增量扫描
  registerLibraryNotify(libraryClient)
  // 观看进度与片库服务（NAS）双向合并：设置了地址才同步
  registerProgressSync(libraryClient)
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
  // 刮削偏好（元数据语言、图片清晰度）：启动时与设置变更时下发给媒体库引擎
  registerScrapePrefsSync(libraryClient)
  registerEngine()
  // AI 基础层：OpenAI 兼容接口 + 用量统计（所有 AI 功能的入口，见 src/main/ai）
  registerAi()
  // AI 字幕：ffmpeg + Whisper 识别 + 大模型翻译，主进程任务队列（见 src/main/ai-subtitles）
  registerAiSubtitles()
  // 前情提要 / 问剧情：之前各集字幕摘要与缓存（见 src/main/recap）
  registerRecap()
  // 网盘搜索（PanSou）+ 115 扫码登录与转存（见 src/main/pan115）
  const moduleHost = desktopModuleHost()
  const pan115Service = registerPan115(moduleHost)
  // 追更：剧集新集播出后搜 115 分享、验过文件只转存那一集（见 src/main/autograb）
  const autograb = registerAutograb(moduleHost, libraryClient, pan115Service, {
    landed: records => notify.landed(records),
  })
  // 入库推送：新集 / 新电影入库发系统通知、Bark、Telegram（见 src/main/notify）；追更转存的集标成追更
  const notify = registerNotify((...episode) => autograb.isSaved(...episode))
  // 洗版 / 电影上线追踪：115 请求共用追更闸门（见 src/main/autograb/upgrade、movies）
  const autograbGate = (): ReturnType<typeof autograb.gate> => autograb.gate()
  const autograbPan = createPanAdapter(pan115Service, () =>
    moduleHost.setting('pan115.pansouUrl')
  )
  const autograbMovies = registerAutograbMovies(
    moduleHost,
    libraryClient,
    autograbPan,
    autograbGate
  )
  registerAutograbUpgrade(
    moduleHost,
    libraryClient,
    autograbPan,
    autograbGate,
    {
      movie: () => autograbMovies.policy(),
      tv: () => autograb.policy(),
    }
  )
  // 库外发现：助手 / 豆瓣卡「找 115 资源」，复用追更的闸门（见 src/main/discover）
  registerDiscover(moduleHost, libraryClient, pan115Service, autograb)
  // 115 离线下载：磁力 / 电驴加进云下载，完成后通知媒体库入库（见 src/main/offline）
  registerOffline(moduleHost, libraryClient, pan115Service)
  // lada / mpv 都按需启动；退出时由插件宿主统一停止并等进程退出
  installPluginHost(app)
  // 内置播放器的独立窗口（见 src/main/player-window）
  playerWindow = registerPlayerWindow({ getMainWindow: () => mainWindow })

  createWindow()
  // 托盘 + 全局媒体键（内置播放器正在播放时）
  installTray({ showMainWindow })
  // AI 助手：全局快捷键唤起（默认 Alt+Space）与语音转写（见 src/main/assistant）
  registerAssistant({ getMainWindow: () => mainWindow, showMainWindow })

  // macOS 点程序坞图标：只看主窗口（后台抓取用的隐藏窗口、播放器窗口不算）——不在了就重建，最小化 / 隐藏了就恢复
  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  // 全局快捷键留到退出时才注销：macOS 关窗不退出，AI 助手的快捷键要能重新唤起窗口
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // 注销所有快捷键
  globalShortcut.unregisterAll()
})
