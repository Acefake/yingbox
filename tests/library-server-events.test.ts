/**
 * 网页端事件流（services/library-server/events.ts）：服务没就绪时关掉交给 onClosed；就绪时的网络断线交给浏览器重连；
 * 浏览器放弃重连（非 200 响应，EventSource 变 CLOSED）而状态仍在线时，探一次服务再重开，间隔翻倍、连上复位。
 */
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  type EventSourceLike,
  RESUME_MAX_MS,
  RESUME_MIN_MS,
  createServerEvents,
} from '../src/renderer/src/services/library-server/events'

/** 假 EventSource：手动触发 open / message / error。 */
class FakeSource implements EventSourceLike {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false
  close(): void {
    this.closed = true
    this.readyState = 2
  }
  open(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent)
  }
  /** 网络断线：浏览器还在重连 */
  drop(): void {
    this.readyState = 0
    this.onerror?.(new Event('error'))
  }
  /** 浏览器放弃：重连拿到非 200 响应 */
  fail(): void {
    this.readyState = 2
    this.onerror?.(new Event('error'))
  }
}

/** 测试夹具 */
interface Harness {
  sources: FakeSource[]
  state: { online: boolean }
  probe: Mock<() => Promise<'online' | 'unauthorized' | 'offline'>>
  onData: Mock<(data: string) => void>
  onClosed: Mock<() => void>
  stream: { close(): void }
}

function setup(online = true): Harness {
  const sources: FakeSource[] = []
  const state = { online }
  const probe = vi.fn<() => Promise<'online' | 'unauthorized' | 'offline'>>(
    async () => 'online'
  )
  const open = createServerEvents({
    create: () => {
      const source = new FakeSource()
      sources.push(source)
      return source
    },
    online: () => state.online,
    probe,
  })
  const onData = vi.fn<(data: string) => void>()
  const onClosed = vi.fn<() => void>()
  const stream = open('/api/library/events', onData, onClosed)
  return { sources, state, probe, onData, onClosed, stream }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createServerEvents', () => {
  it('消息交给 onData；网络断线（还在重连）时什么都不做', () => {
    const h = setup()
    h.sources[0].open()
    h.sources[0].message('{"type":"x"}')
    expect(h.onData).toHaveBeenCalledWith('{"type":"x"}')
    h.sources[0].drop()
    expect(h.sources[0].closed).toBe(false)
    expect(h.onClosed).not.toHaveBeenCalled()
    expect(h.sources).toHaveLength(1)
  })

  it('服务没就绪时关掉并交给 onClosed，不再探测', async () => {
    const h = setup()
    h.state.online = false
    h.sources[0].drop()
    expect(h.sources[0].closed).toBe(true)
    expect(h.onClosed).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RESUME_MAX_MS * 2)
    expect(h.probe).not.toHaveBeenCalled()
    expect(h.sources).toHaveLength(1)
  })

  it('浏览器放弃重连而状态仍在线：探测在线后重新打开', async () => {
    const h = setup()
    h.sources[0].open()
    h.sources[0].fail()
    expect(h.onClosed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RESUME_MIN_MS)
    expect(h.probe).toHaveBeenCalledTimes(1)
    expect(h.sources).toHaveLength(2)
    h.sources[1].message('again')
    expect(h.onData).toHaveBeenCalledWith('again')
  })

  it('探测连不上时间隔翻倍到上限，连上后复位', async () => {
    const h = setup()
    h.probe.mockResolvedValue('offline')
    h.sources[0].fail()
    await vi.advanceTimersByTimeAsync(RESUME_MIN_MS)
    expect(h.probe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RESUME_MIN_MS * 2 - 1)
    expect(h.probe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RESUME_MAX_MS * 4)
    const calls = h.probe.mock.calls.length
    await vi.advanceTimersByTimeAsync(RESUME_MAX_MS)
    expect(h.probe.mock.calls.length).toBe(calls + 1)
    // 服务回来：重开，连上后间隔复位
    h.probe.mockResolvedValue('online')
    await vi.advanceTimersByTimeAsync(RESUME_MAX_MS)
    expect(h.sources).toHaveLength(2)
    h.sources[1].open()
    h.probe.mockClear()
    h.sources[1].fail()
    await vi.advanceTimersByTimeAsync(RESUME_MIN_MS)
    expect(h.probe).toHaveBeenCalledTimes(1)
  })

  it('探测发现要登录：交给 onClosed（连接界面接手）', async () => {
    const h = setup()
    h.probe.mockResolvedValue('unauthorized')
    h.sources[0].fail()
    await vi.advanceTimersByTimeAsync(RESUME_MIN_MS)
    expect(h.onClosed).toHaveBeenCalledTimes(1)
    expect(h.sources).toHaveLength(1)
  })

  it('close() 之后不再探测、不再重开', async () => {
    const h = setup()
    h.sources[0].fail()
    h.stream.close()
    await vi.advanceTimersByTimeAsync(RESUME_MAX_MS)
    expect(h.probe).not.toHaveBeenCalled()
    expect(h.sources).toHaveLength(1)
  })
})
