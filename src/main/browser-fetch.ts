import { BrowserWindow, screen, session } from 'electron'
import { classifyPage } from '../shared/net/cf-page'
import {
  createHostBreaker,
  hostOf,
  pathScope,
} from '../shared/net/host-breaker'

/**
 * 浏览器级抓取：引擎经 MessagePort 请求主进程代抓页面。
 *
 * 部分插件源（jable/hanime/avtoday 等）挂在 Cloudflare 后面，非浏览器客户端
 * 只会拿到挑战页。这里用 Electron 自带的 Chromium 开一个窗口取页面，等挑战结束后
 * 把渲染后的 HTML 交回引擎。原先为 Go/Node 子进程开的本机 HTTP 服务与临时发现文件
 * 已随 Go 后端一起删除。
 *
 * 只有「可通过的挑战页」才把窗口短暂显示出来；硬封锁页（Sorry, you have been blocked、
 * Error 1020 等）一经识别立即销毁窗口、绝不显示，并按主机 + 路径类别熔断 30 分钟，期间同类
 * 请求直接返回空串，不再开窗口。
 */

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// 固定 partition：cf_clearance 等 cookie 跨请求、跨重启保留，避免每次都重新过挑战。
const PARTITION = 'persist:yingbox-browser-fetch'
const DEFAULT_WAIT_MS = 20000
const MAX_WAIT_MS = 30000
const LOAD_TIMEOUT_MS = 25000

// 请求串行执行：多个可见窗口同时闪出既打扰用户，也更容易触发风控。
let queue: Promise<unknown> = Promise.resolve()
/** 同一地址正在排队 / 进行中的请求：重复请求共用结果，不再多开窗口。 */
const pending = new Map<string, Promise<string>>()
/**
 * 浏览器代抓的熔断（主机 + 路径类别，与引擎一致）：硬封锁立即熔断，挑战连续 3 次没过也熔断。
 * 只在内存里；重启后的拦截由引擎落盘的熔断负责（引擎熔断期内不会来请求代抓）。
 */
const breaker = createHostBreaker({ scopeOf: pathScope })

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** 页面可用 = 不是挑战/封锁页，且有真实文档内容（避免把空白/失败页当成成功）。 */
const isUsablePage = (html: string): boolean =>
  typeof html === 'string' &&
  html.length >= 500 &&
  html.includes('<body') &&
  classifyPage(html) === 'ok'

/** 硬封锁：浏览器也过不去。 */
class BlockedPageError extends Error {
  constructor(readonly url: string) {
    super(`blocked: ${url}`)
  }
}

const isHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

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
async function fetchViaBrowser(url: string, waitMs: number): Promise<string> {
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

/** 排队执行一次代抓；轮到时再查熔断，前面的请求刚把主机熔断时不再开窗口。 */
function runFetch(url: string, waitMs: number): Promise<string> {
  const task = queue.then(async () => {
    if (breaker.check(url)) return ''
    try {
      const html = await fetchViaBrowser(url, waitMs)
      if (isUsablePage(html)) breaker.succeed(url)
      else breaker.fail(url, 'challenge')
      return html
    } catch (error) {
      if (error instanceof BlockedPageError) breaker.block(url)
      else breaker.fail(url)
      throw error
    }
  })
  // 队列本身不做错误处理，避免一次失败卡死后续请求。
  queue = task.catch(() => undefined)
  return task
}

/**
 * 引擎请求的浏览器代抓：返回渲染后的 HTML；挑战未通过、硬封锁、主机熔断或加载失败
 * 返回空串。请求串行执行，同一地址同时只开一个窗口。
 */
export async function browserFetch(
  url: string,
  waitMs: number = DEFAULT_WAIT_MS
): Promise<string> {
  if (!isHttpUrl(url) || breaker.check(url)) return ''
  const wait = Math.min(Math.max(waitMs, 0), MAX_WAIT_MS)
  let task = pending.get(url)
  if (!task) {
    task = runFetch(url, wait)
      .catch(() => '')
      .finally(() => pending.delete(url))
    pending.set(url, task)
  }
  const html = await task
  return isUsablePage(html) ? html : ''
}

/** 解除浏览器代抓的主机熔断（用户在数据源面板点「重试」时）；不给主机则全部解除。 */
export function resetBrowserFetch(host?: string): void {
  breaker.reset(host === undefined ? undefined : hostOf(host))
}
