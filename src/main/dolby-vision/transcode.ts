/**
 * 杜比视界播放会话：ffmpeg（libplacebo 重建）按需编 fMP4 HLS 分片，本机 HTTP 服务交给内置播放器。
 *
 * - 播放列表一开始就是完整 VOD（playlist.ts），拖动由服务端按分片请求决定等待还是从新位置重启编码；
 * - 每轮编码最多编 RUN_SEGMENTS 段就退出，播放追近前沿再续编：暂停或切走后编码器最多领先一轮；
 * - 服务只绑 127.0.0.1，路径带随机令牌，只回答 index.m3u8 / init.mp4 / segNNNNN.m4s；
 * - 同一时间只有一个会话（重建很吃 GPU / CPU）：开会话串行执行，开新的先停旧的；
 * - 等分片最多 SEGMENT_WAIT_MS（短于 hls.js 首字节超时 10 秒），没等到回 503，播放器按退避重试；
 * - 分片目录在系统临时目录下，会话结束删除，启动时清扫崩溃留下的旧目录（sweepLeftovers）。
 */
import { randomBytes } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type Session,
  type SessionPlan,
  afterServe,
  logError,
  refreshReady,
  serial,
  startEncoder,
  stateOf,
  stopEncoder,
} from './encoder'
import { segmentFile } from './filters'
import {
  buildVodPlaylist,
  parseRequestName,
  planSegment,
  segmentAt,
  segmentCount,
} from './playlist'

export type { SessionPlan } from './encoder'

/** 一次请求等分片的上限：短于 hls.js 的首字节超时（10 秒），超时回 503 由播放器重试 */
export const SEGMENT_WAIT_MS = 8_000
/** 等分片时的轮询间隔 */
const POLL_MS = 150

/** 分片目录的根（测试可改到自己的临时目录）。 */
let sessionRoot = join(tmpdir(), 'yingbox-dolby-vision')

/** 改分片目录的根（测试用）。 */
export function setSessionRoot(dir: string): void {
  sessionRoot = dir
}

let current: Session | null = null
/** 开 / 停会话串行执行：并发的开播不会互相停掉对方刚建好的会话 */
let lifecycle: Promise<unknown> = Promise.resolve()

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** 把开 / 停会话排进全局串行队列。 */
function inLifecycle<T>(task: () => Promise<T>): Promise<T> {
  const run = lifecycle.then(task, task)
  lifecycle = run.catch(() => {})
  return run
}

/**
 * 等某个文件就绪（编码器写完）。编码器停着、队列也空闲（一轮编完或被暂停）而文件还没有时，
 * 从 restartAt 起编；编码器重启期间（队列里有操作）照常等待。
 * @returns 就绪返回 true；会话关了、请求断了、编码失败或超时返回 false
 */
async function waitForFile(
  s: Session,
  check: () => Promise<boolean>,
  req: IncomingMessage,
  restartAt: number
): Promise<boolean> {
  const deadline = Date.now() + SEGMENT_WAIT_MS
  while (Date.now() < deadline) {
    if (s.closed || req.destroyed) return false
    if (await check()) return true
    if (s.failed && s.child === null && s.pending === 0) return false
    if (s.child === null && s.pending === 0)
      await serial(s, async () => {
        if (s.child === null && !s.closed && !(await check()))
          await startEncoder(s, restartAt)
      })
    await sleep(POLL_MS)
  }
  return false
}

const send = (res: ServerResponse, file: string, type: string): void => {
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
}

const reply = (res: ServerResponse, status: number): void => {
  res.statusCode = status
  res.end()
}

/** 回答一个请求：播放列表即时生成，init / 分片按需等编码器。 */
async function handle(
  s: Session,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const path = decodeURIComponent((req.url || '/').split('?')[0])
  const prefix = `/${s.token}/`
  const request = path.startsWith(prefix)
    ? parseRequestName(path.slice(prefix.length))
    : null
  if (!request) return reply(res, 404)
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (request.kind === 'playlist') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-store')
    res.end(buildVodPlaylist(s.plan.duration))
    return
  }
  if (request.kind === 'init') {
    const init = join(s.dir, 'init.mp4')
    // ffmpeg 先建空的 init.mp4，写完第一个分片时才填好：有分片且 init 非空才算就绪
    const initReady = async (): Promise<boolean> => {
      await refreshReady(s)
      if (!s.ready.size) return false
      const stat = await fs.stat(init).catch(() => null)
      return Boolean(stat && stat.size > 0)
    }
    if (!(await waitForFile(s, initReady, req, s.playing)))
      return reply(res, s.failed ? 500 : 503)
    return send(res, init, 'video/mp4')
  }
  const { index } = request
  if (index >= s.count) return reply(res, 404)
  await serial(s, async () => {
    await refreshReady(s)
    if (planSegment(stateOf(s), index) === 'restart')
      await startEncoder(s, index)
  })
  const segmentReady = async (): Promise<boolean> => {
    await refreshReady(s)
    return s.ready.has(index)
  }
  if (!(await waitForFile(s, segmentReady, req, index)))
    return reply(res, s.failed ? 500 : 503)
  send(res, join(s.dir, segmentFile(index)), 'video/mp4')
  // 收尾不阻塞这次响应，失败也只记日志
  void serial(s, () => afterServe(s, index)).catch(logError('分片收尾失败'))
}

/** 起只绑 127.0.0.1 的服务，返回端口。 */
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

/** 关服务、停编码器、删目录（会话已从 current 摘下或从未挂上）。 */
async function teardown(s: Session): Promise<void> {
  s.closed = true
  await serial(s, () => stopEncoder(s))
  s.server.closeAllConnections()
  s.server.close()
  await fs
    .rm(s.dir, { recursive: true, force: true })
    .catch(logError(`删除分片目录 ${s.dir} 失败`))
}

/** 建会话：目录、服务、首轮编码；任何一步失败都清理干净再抛出。 */
async function openSession(
  plan: SessionPlan
): Promise<{ id: string; url: string }> {
  const id = randomBytes(6).toString('hex')
  const dir = join(sessionRoot, id)
  await fs.mkdir(dir, { recursive: true })
  const count = segmentCount(plan.duration)
  const s: Session = {
    id,
    token: randomBytes(16).toString('hex'),
    dir,
    plan,
    count,
    server: createServer(),
    child: null,
    runningFrom: null,
    ready: new Set(),
    playing: segmentAt(plan.startAt, count),
    stderr: '',
    failed: '',
    closed: false,
    queue: Promise.resolve(),
    pending: 0,
  }
  s.server.on('request', (req, res) => {
    handle(s, req, res).catch(error => {
      logError('请求处理失败')(error)
      if (!res.headersSent) reply(res, 500)
      else res.destroy()
    })
  })
  try {
    const port = await listen(s.server)
    await serial(s, () => startEncoder(s, s.playing))
    if (s.failed) throw new Error(s.failed)
    current = s
    return { id, url: `http://127.0.0.1:${port}/${s.token}/index.m3u8` }
  } catch (error) {
    await teardown(s)
    throw error
  }
}

/**
 * 开一个杜比视界播放会话（先停掉已有的）：建分片目录、起本机服务、从起播位置所在的段开始编码。
 * 与其他开 / 停串行执行；失败时不留下会话、服务或目录。
 * @returns 会话 id 与交给内置播放器的 m3u8 地址
 */
export function startSession(
  plan: SessionPlan
): Promise<{ id: string; url: string }> {
  return inLifecycle(async () => {
    await stopCurrent()
    return openSession(plan)
  })
}

/** 停当前会话（已在生命周期队列里调用）。 */
async function stopCurrent(id?: string): Promise<boolean> {
  const s = current
  if (!s || (id && s.id !== id)) return false
  current = null
  await teardown(s)
  return true
}

/**
 * 停止会话：杀编码器、关服务、删分片目录。不给 id 时停当前会话；id 对不上（已被新会话替换）什么都不做。
 * @returns 是否真的停了一个会话
 */
export function stopSession(id?: string): Promise<boolean> {
  return inLifecycle(() => stopCurrent(id))
}

/** 当前有没有会话在跑（退出清理用）。 */
export const sessionRunning = (): boolean => current !== null

/**
 * 清扫分片目录根下不属于当前会话的旧目录（上次崩溃或强杀留下的）。启动时调用一次；失败只记日志。
 * @returns 删掉的目录数
 */
export function sweepLeftovers(): Promise<number> {
  return inLifecycle(async () => {
    const names = await fs.readdir(sessionRoot).catch(() => [] as string[])
    let removed = 0
    for (const name of names) {
      if (name === current?.id) continue
      const ok = await fs
        .rm(join(sessionRoot, name), { recursive: true, force: true })
        .then(() => true)
        .catch(error => {
          logError(`清扫旧分片目录 ${name} 失败`)(error)
          return false
        })
      if (ok) removed++
    }
    return removed
  })
}
