/**
 * 独立播放器窗口：内置播放器（点播）在这个窗口里播放，主窗口只负责发起。
 *
 * - 单例：没开就创建，开着就换片（play 事件）并聚焦；页面就绪前到的载荷存着，ready 时取走；
 * - 无边框、黑底，窗口键与主窗口同一套（渲染层 WinControls）；全屏走页面的 HTML 全屏（Esc 退出）；
 *   置顶跟设置 player.windowOnTop（窗口顶栏图钉与设置页同一个开关）；
 * - 位置与大小关窗时记进设置 player.windowBounds，下次打开沿用（不在任何屏幕上时回到主屏居中，见 bounds.ts）；
 * - 关窗即停止播放；主窗口关闭时一起关（src/main/index.ts 调 close）；
 * - 进度事件与在播状态原样转给主窗口（片库进度缓存、继续播放、AI 助手都在主窗口）；播完提示里的应用内地址
 *   （如「去追更」）交给主窗口打开并把它带到前面；
 *   主窗口的遥控请求转给播放器窗口，回执经 reply 带回，5 秒没回按失败；
 * - 安全：沿用 window-security（禁导航、外链交系统浏览器），preload 只暴露播放用到的域（shared/player-window.ts 的 PLAYER_WINDOW_DOMAINS），
 *   CSP 与主窗口同一份（会话级响应头 + player.html 的 meta）。
 */
import { is } from '@electron-toolkit/utils'
import { BrowserWindow, type WebContents, screen, shell } from 'electron'
import { join } from 'path'
import { playerWindow } from '../../shared/contract/player-window'
import {
  PLAYER_WINDOW_ARG,
  type PlayerWindowPayload,
  type PlayerWindowReply,
} from '../../shared/player-window'
import { emit, implement } from '../rpc'
import { onSettingChanged, settingsStore } from '../settings'
import { installWindowSecurity } from '../window-security'
import { PLAYER_WINDOW_MIN, restoreBounds } from './bounds'

/** 遥控请求等回执的最长时间 */
const REPLY_TIMEOUT_MS = 5000

/** registerPlayerWindow 需要的窗口操作（主窗口生命周期归 src/main/index.ts） */
export interface PlayerWindowHost {
  /** 主窗口（关闭后为 null） */
  getMainWindow: () => BrowserWindow | null
}

/** 主进程其它地方用到的操作 */
export interface PlayerWindowControl {
  /** 关掉播放器窗口（主窗口关闭时） */
  close: () => void
}

/** 注册 playerWindow 域（app ready 后、设置初始化后调用一次） */
export function registerPlayerWindow(
  host: PlayerWindowHost
): PlayerWindowControl {
  let win: BrowserWindow | null = null
  /** 播放器页面已调过 ready（之后换片直接发 play） */
  let ready = false
  /** 页面就绪前到的载荷 */
  let pending: PlayerWindowPayload | null = null
  let requestSeq = 0
  const replies = new Map<number, (reply: PlayerWindowReply) => void>()

  const mainContents = (): WebContents | null => {
    const main = host.getMainWindow()
    return main && !main.isDestroyed() ? main.webContents : null
  }

  const fromMain = (sender: WebContents): void => {
    if (sender !== mainContents()) throw new Error('只有主窗口可以调用')
  }

  const fromPlayer = (sender: WebContents): void => {
    if (!win || sender !== win.webContents)
      throw new Error('只有播放器窗口可以调用')
  }

  /** 等着的遥控请求一律按失败回执 */
  const settleReplies = (text: string): void => {
    for (const resolve of replies.values()) resolve({ ok: false, text })
    replies.clear()
  }

  const create = (): BrowserWindow => {
    const store = settingsStore()
    const bounds = restoreBounds(
      store.get('player.windowBounds'),
      screen.getAllDisplays().map(d => d.workArea),
      screen.getPrimaryDisplay().workArea
    )
    const next = new BrowserWindow({
      ...bounds,
      minWidth: PLAYER_WINDOW_MIN.width,
      minHeight: PLAYER_WINDOW_MIN.height,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      title: '影盒 · 播放器',
      alwaysOnTop: store.get('player.windowOnTop'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // preload 据此只暴露播放用到的域（shared/player-window.ts 的 PLAYER_WINDOW_DOMAINS）
        additionalArguments: [PLAYER_WINDOW_ARG],
        sandbox: true,
        webSecurity: true,
      },
    })
    installWindowSecurity(next.webContents, url => shell.openExternal(url))
    next.once('ready-to-show', () => {
      next.show()
      next.focus()
    })
    // 记位置：最大化 / 全屏时记还原后的大小
    next.on('close', () => {
      const { x, y, width, height } = next.getNormalBounds()
      try {
        store.set('player.windowBounds', { x, y, width, height })
      } catch (error) {
        console.warn('[player-window] 记位置失败', (error as Error).message)
      }
    })
    next.on('closed', () => {
      if (win === next) {
        win = null
        ready = false
        pending = null
      }
      settleReplies('播放器已关闭')
      const main = mainContents()
      if (main) emit(playerWindow, 'session', null, main)
    })
    // 页面重载（开发时）：重新走 ready
    next.webContents.on('did-start-navigation', details => {
      if (details.isMainFrame && !details.isSameDocument) ready = false
    })
    if (is.dev && process.env['ELECTRON_RENDERER_URL'])
      void next.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/player.html`)
    else void next.loadFile(join(__dirname, '../renderer/player.html'))
    return next
  }

  const focus = (target: BrowserWindow): void => {
    if (target.isMinimized()) target.restore()
    if (target.isVisible()) target.focus()
  }

  onSettingChanged(change => {
    if (change.key === 'player.windowOnTop' && win)
      win.setAlwaysOnTop(change.value)
  })

  implement(playerWindow, {
    open: ({ sender }, payload) => {
      fromMain(sender)
      if (win && ready) {
        emit(playerWindow, 'play', payload, win.webContents)
        focus(win)
        return
      }
      pending = payload
      if (win) focus(win)
      else win = create()
    },
    close: () => {
      win?.close()
    },
    command: ({ sender }, request) => {
      fromMain(sender)
      if (!win || !ready) return { ok: false, text: '现在没有正在播放的视频' }
      const id = ++requestSeq
      // 问剧情的面板在播放器窗口里：把它带到前面
      if (request.kind === 'ask') focus(win)
      emit(playerWindow, 'remote', { id, request }, win.webContents)
      return new Promise<PlayerWindowReply>(resolve => {
        const timer = setTimeout(() => {
          replies.delete(id)
          resolve({ ok: false, text: '播放器没有响应' })
        }, REPLY_TIMEOUT_MS)
        replies.set(id, reply => {
          clearTimeout(timer)
          resolve(reply)
        })
      })
    },
    ready: ({ sender }) => {
      fromPlayer(sender)
      ready = true
      const payload = pending
      pending = null
      return payload
    },
    progress: ({ sender }, event) => {
      fromPlayer(sender)
      const main = mainContents()
      if (main) emit(playerWindow, 'relay', event, main)
    },
    state: ({ sender }, state) => {
      fromPlayer(sender)
      const main = mainContents()
      if (main) emit(playerWindow, 'session', state, main)
    },
    navigate: ({ sender }, to) => {
      fromPlayer(sender)
      const main = host.getMainWindow()
      if (!main || main.isDestroyed()) return
      emit(playerWindow, 'route', to, main.webContents)
      if (main.isMinimized()) main.restore()
      main.show()
      main.focus()
    },
    reply: ({ sender }, id, reply) => {
      fromPlayer(sender)
      const resolve = replies.get(id)
      replies.delete(id)
      resolve?.(reply)
    },
  })

  return {
    close: () => win?.close(),
  }
}
