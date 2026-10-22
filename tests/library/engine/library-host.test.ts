/**
 * 媒体库引擎宿主（src/main/library/engine-host.ts）迁到 UtilityHost 后的约定：错误码、
 * 关停超时 kill、关停中订阅 / 调用等旧进程、ready、原图已下载通知。
 * 订阅重挂的端到端行为见 resubscribe.test.ts（#53）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type LibraryChild,
  LibraryEngineHost,
  type LibraryHostDeps,
} from '../../../src/main/library/engine-host'
import type {
  EngineMessage,
  HostMessage,
} from '../../../src/shared/library/ipc'

/** 假引擎进程：记录收到的消息，测试决定何时回复 / 退出。 */
class FakeChild implements LibraryChild {
  readonly inbox: HostMessage[] = []
  private readonly onMsg: Array<(m: EngineMessage) => void> = []
  private readonly onExit: Array<(c: number) => void> = []
  alive = true
  kills = 0
  constructor(readonly n: number) {}
  postMessage(message: HostMessage): void {
    this.inbox.push(message)
  }
  on(event: 'message', listener: (message: EngineMessage) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'message' | 'exit', listener: never): void {
    if (event === 'message') this.onMsg.push(listener)
    else this.onExit.push(listener)
  }
  kill(): boolean {
    this.kills++
    this.exit(-1)
    return true
  }
  send(message: EngineMessage): void {
    if (this.alive) this.onMsg.forEach(l => l(message))
  }
  exit(code: number): void {
    if (!this.alive) return
    this.alive = false
    this.onExit.forEach(l => l(code))
  }
  kinds(): string[] {
    return this.inbox.map(m => m.kind)
  }
  lastRequestId(): number {
    const requests = this.inbox.filter(m => m.kind === 'request')
    return (requests.at(-1) as { id: number }).id
  }
}

function setup(over: Partial<LibraryHostDeps> = {}): {
  host: LibraryEngineHost
  children: FakeChild[]
  delivered: string[]
  log: string[]
} {
  const children: FakeChild[] = []
  const delivered: string[] = []
  const log: string[] = []
  let channels = 0
  const host = new LibraryEngineHost({
    fork: () => {
      const child = new FakeChild(children.length + 1)
      children.push(child)
      return child
    },
    createChannel: () => {
      channels++
      return { port1: `p1-${channels}`, port2: `p2-${channels}` }
    },
    onImagesCached: keys => log.push(`images ${keys.join(',')}`),
    onReady: ms => log.push(`ready ${ms >= 0}`),
    ...over,
  })
  return { host, children, delivered, log }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('媒体库引擎宿主（UtilityHost）', () => {
  it('结果与引擎错误码原样回到 InvokeResult', async () => {
    const { host, children } = setup()
    const ok = host.invoke('listLibraries', undefined)
    children[0].send({
      kind: 'response',
      id: children[0].lastRequestId(),
      ok: true,
      result: [1],
    })
    await expect(ok).resolves.toEqual({ ok: true, result: [1] })
    const bad = host.invoke('getItem', { id: 9 })
    children[0].send({
      kind: 'response',
      id: children[0].lastRequestId(),
      ok: false,
      error: { code: 'not-found', message: '没有这个条目' },
    })
    await expect(bad).resolves.toEqual({
      ok: false,
      error: { code: 'not-found', message: '没有这个条目' },
    })
  })

  it('未知方法直接拒绝，不 fork 引擎', async () => {
    const { host, children } = setup()
    await expect(host.invoke('dropDatabase', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown-method' },
    })
    expect(children).toHaveLength(0)
  })

  it('引擎崩溃：挂起调用以 engine-unavailable 失败，下一次调用才重启', async () => {
    const { host, children } = setup()
    const hanging = host.invoke('listLibraries', undefined)
    children[0].exit(1)
    await expect(hanging).resolves.toEqual({
      ok: false,
      error: {
        code: 'engine-unavailable',
        message: '媒体库引擎已退出（code 1）',
      },
    })
    expect(host.running).toBe(false)
    expect(children).toHaveLength(1)
    void host.invoke('listLibraries', undefined)
    expect(children).toHaveLength(2)
  })

  it('关停：发 shutdown，引擎退出即完成；挂起调用以 engine-unavailable 失败', async () => {
    const { host, children } = setup()
    const hanging = host.invoke('listLibraries', undefined)
    const done = host.shutdown()
    expect(children[0].kinds().at(-1)).toBe('shutdown')
    children[0].exit(0)
    await done
    await expect(hanging).resolves.toMatchObject({
      ok: false,
      error: { code: 'engine-unavailable', message: '媒体库引擎已关停' },
    })
    expect(children[0].kills).toBe(0)
  })

  it('关停超时（引擎卡在关库）：到点 kill', async () => {
    const { host, children } = setup({ stopTimeoutMs: 3_000 })
    host.subscribe(1, { deliver: () => {} })
    const done = host.shutdown()
    await vi.advanceTimersByTimeAsync(2_999)
    expect(children[0].kills).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(children[0].kills).toBe(1)
  })

  it('关停中来了订阅与调用：等旧引擎退完才 fork，新引擎先接通道再收调用', async () => {
    const { host, children, delivered } = setup()
    host.subscribe(1, { deliver: p => void delivered.push(`w1 ${p}`) })
    const done = host.shutdown()
    host.subscribe(2, { deliver: p => void delivered.push(`w2 ${p}`) })
    const call = host.invoke('listLibraries', undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(children).toHaveLength(1)
    expect(delivered).toEqual(['w1 p2-1'])
    children[0].exit(0)
    await done
    await vi.advanceTimersByTimeAsync(0)
    expect(children).toHaveLength(2)
    expect(children[1].kinds()).toEqual(['subscribe', 'subscribe', 'request'])
    expect(delivered).toEqual(['w1 p2-1', 'w1 p2-2', 'w2 p2-3'])
    children[1].send({
      kind: 'response',
      id: children[1].lastRequestId(),
      ok: true,
      result: null,
    })
    await expect(call).resolves.toEqual({ ok: true, result: null })
  })

  it('媒体库引擎不空闲退出', async () => {
    const { host, children } = setup()
    const call = host.invoke('listLibraries', undefined)
    children[0].send({
      kind: 'response',
      id: children[0].lastRequestId(),
      ok: true,
      result: [],
    })
    await call
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(host.running).toBe(true)
    expect(children[0].kinds()).not.toContain('shutdown')
  })

  it('首次订阅即启动引擎并接上通道（目录监控随窗口打开就开始）', () => {
    const { host, children, delivered } = setup()
    host.subscribe(1, { deliver: p => void delivered.push(`w1 ${p}`) })
    expect(children).toHaveLength(1)
    expect(children[0].kinds()).toEqual(['subscribe'])
    expect(delivered).toEqual(['w1 p2-1'])
  })

  it('ready 回调 onReady；原图已下载通知转给 onImagesCached', () => {
    const { host, children, log } = setup()
    host.subscribe(1, { deliver: () => {} })
    children[0].send({ kind: 'ready' })
    children[0].send({ kind: 'images-cached', keys: ['a', 'b'] })
    expect(log).toEqual(['ready true', 'images a,b'])
  })
})
