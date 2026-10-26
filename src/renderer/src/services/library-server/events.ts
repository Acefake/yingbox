/**
 * 网页端连片库服务的事件流（SSE）：片库、契约域（网盘 / 追更）、在线引擎三条事件流共用这一份打开逻辑。
 *
 * - 服务没就绪（连不上 / 未登录）时关掉事件流，交给 onClosed（transport 丢掉它，服务回到在线时 resume() 重开），
 *   别让浏览器无限重连；
 * - 就绪时的网络断线由浏览器按 `retry:` 自动重连；
 * - 浏览器自己放弃（重连拿到非 200 响应：反向代理在服务重启时回 502 / 503，令牌换了回 401）时 EventSource
 *   变成 CLOSED、不会再连，而连接状态仍是在线：这里先探一次服务，在线就重新打开（间隔从 3 秒翻倍到 60 秒，
 *   连上后复位），要登录就交给连接界面，连不上就过一会儿再探。
 */
import { libraryServerState, probeLibraryServerAgain } from './index'

/** 打开的事件流。 */
export interface ServerEventStream {
  close(): void
}

/** EventSource 里用到的部分（单测用假实现）。 */
export interface EventSourceLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

/** 依赖。 */
export interface ServerEventsDeps {
  /** 建 EventSource（同源、带 Cookie） */
  create(url: string): EventSourceLike
  /** 连接状态当前是否在线 */
  online(): boolean
  /** 重新探测服务（会更新连接状态）；只在浏览器放弃重连后调用 */
  probe(): Promise<'online' | 'unauthorized' | 'offline'>
}

/** EventSource.CLOSED */
const CLOSED = 2
/** 浏览器放弃后再探测的间隔：首次与上限 */
export const RESUME_MIN_MS = 3000
export const RESUME_MAX_MS = 60_000

/** 按依赖创建打开函数（形状与各 transport 的 openEvents 相同）。 */
export function createServerEvents(
  deps: ServerEventsDeps
): (
  url: string,
  onData: (data: string) => void,
  onClosed: () => void
) => ServerEventStream {
  return (url, onData, onClosed) => {
    let source: EventSourceLike | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = RESUME_MIN_MS
    let stopped = false

    const stop = (): void => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      source?.close()
      source = null
    }
    const giveUp = (): void => {
      stop()
      onClosed()
    }
    const later = (): void => {
      timer = setTimeout(() => void resume(), delay)
      delay = Math.min(delay * 2, RESUME_MAX_MS)
    }

    async function resume(): Promise<void> {
      timer = null
      if (stopped) return
      const state = await deps.probe().catch(() => 'offline' as const)
      if (stopped) return
      if (state === 'online') connect()
      else if (state === 'unauthorized') giveUp()
      else later()
    }

    function connect(): void {
      const current = deps.create(url)
      source = current
      current.onopen = () => {
        delay = RESUME_MIN_MS
      }
      current.onmessage = event => onData(String(event.data))
      current.onerror = () => {
        if (!deps.online()) return giveUp()
        // 还在重连（网络断线）：交给浏览器
        if (current.readyState !== CLOSED) return
        current.close()
        if (source === current) source = null
        later()
      }
    }

    connect()
    return { close: stop }
  }
}

/** 默认实现：浏览器的 EventSource + 片库服务的连接状态。 */
export const openServerEvents = createServerEvents({
  create: url => new EventSource(url, { withCredentials: true }),
  online: () => libraryServerState().value === 'online',
  probe: probeLibraryServerAgain,
})
