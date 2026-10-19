import { app, BrowserWindow, screen, session } from 'electron'
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'http'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'

/**
 * 浏览器级抓取服务。
 *
 * 部分插件源（jable/hanime/avtoday 等）挂在 Cloudflare 后面，非浏览器客户端
 * 只会拿到挑战页；后端的 Node 抓取器无法执行挑战脚本。这里用 Electron 自带的
 * Chromium 开一个窗口取页面，再把渲染后的 HTML 交回抓取器。
 *
 * 抓取器（Node 子进程）无法直接访问主进程，因此服务监听本机随机端口，并把
 * 端点与令牌写入临时文件供其发现；见 catspider_runner.js 的 browserFetch。
 */

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// 固定 partition：cf_clearance 等 cookie 跨请求、跨重启保留，避免每次都重新过挑战。
const PARTITION = 'persist:yingbox-browser-fetch'
const DISCOVERY_NAME = 'yingbox-browser-fetch.json'
const DISCOVERY_FILE = join(tmpdir(), DISCOVERY_NAME)
const DEFAULT_WAIT_MS = 20000
const MAX_WAIT_MS = 30000
const LOAD_TIMEOUT_MS = 25000

const CHALLENGE_MARKERS = [
  'Just a moment',
  'Attention Required',
  'Enable JavaScript and cookies to continue',
  '安全验证',
  'cf-browser-verification',
  'cf_chl_opt',
]

interface FetchRequest {
  url?: unknown
  waitMs?: unknown
}

let server: Server | null = null
let token = ''
// 请求串行执行：多个可见窗口同时闪出既打扰用户，也更容易触发风控。
let queue: Promise<unknown> = Promise.resolve()

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

const isChallengePage = (html: string): boolean =>
  CHALLENGE_MARKERS.some(marker => html.includes(marker))

/** 页面可用 = 不是挑战页，且有真实文档内容（避免把空白/失败页当成成功）。 */
const isUsablePage = (html: string): boolean =>
  typeof html === 'string' &&
  html.length >= 500 &&
  html.includes('<body') &&
  !isChallengePage(html)

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
    }
    return html
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function runFetch(url: string, waitMs: number): Promise<string> {
  const task = queue.then(() => fetchViaBrowser(url, waitMs))
  // 队列本身不做错误处理，避免一次失败卡死后续请求。
  queue = task.catch(() => undefined)
  return task
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/fetch') {
    sendJson(res, 404, { ok: false, error: 'not found' })
    return
  }
  if (req.headers['x-yingbox-token'] !== token) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }

  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    void (async () => {
      try {
        const body = JSON.parse(
          Buffer.concat(chunks).toString('utf-8') || '{}'
        ) as FetchRequest
        const url = typeof body.url === 'string' ? body.url.trim() : ''
        if (!url || !isHttpUrl(url)) {
          sendJson(res, 400, { ok: false, error: 'invalid url' })
          return
        }
        const rawWait = Number(body.waitMs)
        const waitMs = Number.isFinite(rawWait)
          ? Math.min(Math.max(rawWait, 0), MAX_WAIT_MS)
          : DEFAULT_WAIT_MS
        const html = await runFetch(url, waitMs)
        if (!isUsablePage(html)) {
          sendJson(res, 200, { ok: false, error: 'challenge not passed' })
          return
        }
        sendJson(res, 200, { ok: true, html })
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          error:
            error instanceof Error ? error.message : 'browser fetch failed',
        })
      }
    })()
  })
}

function discoveryTargets(): string[] {
  const targets = [DISCOVERY_FILE]
  try {
    targets.push(join(app.getPath('userData'), DISCOVERY_NAME))
  } catch {
    // app 尚未 ready 时只使用临时目录。
  }
  targets.push(join(process.cwd(), 'output', DISCOVERY_NAME))
  return targets
}

function publishDiscovery(body: string): boolean {
  const errors: unknown[] = []
  for (const target of discoveryTargets()) {
    const pendingFile = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(pendingFile, body, { encoding: 'utf-8', mode: 0o600 })
      renameSync(pendingFile, target)
      return true
    } catch (error) {
      errors.push(error)
    } finally {
      try {
        rmSync(pendingFile, { force: true })
      } catch {
        // A locked temporary file must not interrupt application startup.
      }
    }
  }
  for (const error of errors) {
    console.error('[browser-fetch] cannot publish discovery file:', error)
  }
  return false
}

export function startBrowserFetchService(): void {
  if (server) return
  token = randomBytes(24).toString('hex')
  server = createServer(handleRequest)
  server.on('error', error => {
    console.error('[browser-fetch] server error:', error.message)
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server?.address()
    if (!address || typeof address === 'string') return
    const endpoint = `http://127.0.0.1:${address.port}`
    const body = JSON.stringify({
      url: endpoint,
      token,
      pid: process.pid,
      updatedAt: Date.now(),
    })
    if (!publishDiscovery(body)) {
      server?.close()
      server = null
      token = ''
      return
    }
    console.log(`[browser-fetch] listening on ${endpoint}`)
  })

  session.fromPartition(PARTITION).setUserAgent(CHROME_UA)
}

export function stopBrowserFetchService(): void {
  server?.close()
  server = null
  token = ''
  try {
    const discovery = JSON.parse(readFileSync(DISCOVERY_FILE, 'utf-8'))
    if (discovery.pid === process.pid) rmSync(DISCOVERY_FILE, { force: true })
  } catch {
    /* 文件可能已被清理 */
  }
}
