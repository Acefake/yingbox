import { BrowserWindow, screen, session } from 'electron'
import { classifyPage } from '../../shared/net/cf-page'
import { BlockedPageError, CHROME_UA, PARTITION, isUsablePage } from './page'

/**
 * 窗口渲染：用 Electron 自带的 Chromium 开一个窗口取页面，等 Cloudflare 挑战结束后把渲染后的
 * HTML 交回。只有「可通过的挑战页」才把窗口短暂显示出来（不抢焦点）；硬封锁页一经识别立即
 * 销毁窗口、绝不显示，抛 BlockedPageError 交由调用方熔断。
 */

const LOAD_TIMEOUT_MS = 25000

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** 挑一个不挡路的窗口位置：优先屏幕右下角，挑战页需要可见才会继续。 */
function getWindowBounds(): {
  x: number
  y: number
  width: number
  height: number
} {
  const width = 480
  const height = 360
  try {
    const { workArea } = screen.getPrimaryDisplay()
    return {
      width,
      height,
      x: Math.max(workArea.x, workArea.x + workArea.width - width - 12),
      y: Math.max(workArea.y, workArea.y + workArea.height - height - 12),
    }
  } catch {
    return { width, height, x: 0, y: 0 }
  }
}

/**
 * 打开页面并等待 Cloudflare 挑战结束，返回渲染后的 HTML。
 * 每次请求都用新窗口：复用窗口时，上一次超时的导航会打断下一次加载。
 * cookie 存在 partition 会话里，跨窗口仍然有效。
 */
export async function fetchViaWindow(
  url: string,
  waitMs: number
): Promise<string> {
  session.fromPartition(PARTITION).setUserAgent(CHROME_UA)

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    ...getWindowBounds(),
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 窗口不可见时默认会被节流，而挑战脚本依赖定时器，必须关掉节流。
      backgroundThrottling: false,
    },
  })
  win.webContents.setUserAgent(CHROME_UA)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const readHtml = async (): Promise<string> => {
    if (win.isDestroyed()) return ''
    // webContents.executeJavaScript waits for full loading too; the main frame
    // API lets us inspect a ready DOM while unrelated image requests are pending.
    const value = await win.webContents.mainFrame.executeJavaScript(
      'document.documentElement ? document.documentElement.outerHTML : ""',
      true
    )
    return typeof value === 'string' ? value : ''
  }

  try {
    // loadURL waits for did-finish-load, including slow subresources. The main
    // document can already expose a verification UI before those requests finish.
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        if (!win.isDestroyed())
          win.webContents.removeListener('dom-ready', ready)
      }
      const ready = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const failed = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        void readHtml().then(html => {
          if (isUsablePage(html) && win.webContents.getURL() === url) ready()
          else failed(new Error('browser load timeout'))
        }, failed)
      }, LOAD_TIMEOUT_MS)
      win.webContents.once('dom-ready', ready)
      void win.loadURL(url).then(ready, failed)
    })

    let html = await readHtml()
    // 硬封锁：窗口从未显示，直接销毁（finally）并交由调用方熔断。
    if (classifyPage(html) === 'blocked') throw new BlockedPageError(url)
    // Cloudflare 的挑战脚本要求页面处于可见状态才会继续；命中挑战页时才把窗口
    // 短暂显示出来（不抢焦点），通过后立即销毁；普通站点全程不出现窗口。
    const needsVisible = !isUsablePage(html)
    if (needsVisible && !win.isVisible() && !win.isDestroyed()) {
      win.showInactive()
    }

    const deadline = Date.now() + waitMs
    while (Date.now() < deadline && !isUsablePage(html)) {
      await delay(1000)
      html = await readHtml()
      // 挑战跳转到了封锁页：立即收起，不再等满时限。
      if (classifyPage(html) === 'blocked') throw new BlockedPageError(url)
    }
    return html
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
