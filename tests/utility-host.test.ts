/**
 * UtilityHost（main/utility/host.ts）：两个 utilityProcess 共用的宿主。
 * 用一个说统一线协议（shared/utility/protocol.ts）的最小假子进程直接测生命周期。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UtilityCallError,
  type UtilityChild,
  UtilityHost,
  type UtilityHostOptions,
} from '../src/main/utility/host'
import type { FromUtility, ToUtility } from '../src/shared/utility/protocol'

/** 假子进程：记录收到的消息，由测试决定何时回复 / 退出。 */
class FakeChild implements UtilityChild {
  readonly inbox: ToUtility[] = []
  readonly transfers: unknown[][] = []
  private readonly onMsg: Array<(m: FromUtility) => void> = []
  private readonly onExit: Array<(c: number) => void> = []
  alive = true
  kills = 0
  constructor(readonly n: number) {}
  postMessage(message: ToUtility, transfer?: unknown[]): void {
    this.inbox.push(message)
    if (transfer) this.transfers.push(transfer)
  }
  on(event: 'message', listener: (message: FromUtility) => void): void
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
  send(message: FromUtility): void {
    if (this.alive) this.onMsg.forEach(l => l(message))
  }
  exit(code: number): void {
    if (!this.alive) return
    this.alive = false
    this.onExit.forEach(l => l(code))
  }
  /** 回复收到的第 i 个调用：成功时回参数大写，失败时带 code */
  reply(i = 0, ok = true, code?: string): void {
    const calls = this.inbox.filter(m => m.kind === 'call')
    const c = calls[i] as Extract<ToUtility, { kind: 'call' }>
    const text = String(c.args[0]).toUpperCase()
    this.send(
      ok
        ? { kind: 'result', id: c.id, ok: true, value: text }
        : {
            kind: 'result',
            id: c.id,
            ok: false,
            error: { message: text, code },
          }
    )
  }
}

function setup(over: Partial<UtilityHostOptions> = {}): {
  host: UtilityHost
  children: FakeChild[]
  log: string[]
  call: (text: string) => Promise<unknown>
} {
  const children: FakeChild[] = []
  const log: string[] = []
  let clock = 0
  const host = new UtilityHost({
    name: '测试进程',
    fork: () => {
      const child = new FakeChild(children.length + 1)
      children.push(child)
      log.push(`fork ${child.n}`)
      return child
    },
    onEvent: (channel, payload) => log.push(`event ${channel} ${payload}`),
    onStart: child => {
      log.push(`start ${(child as FakeChild).n}`)
      child.postMessage({ kind: 'subscribe' })
    },
    onReady: ms => log.push(`ready ${ms}`),
    now: () => (clock += 7),
    ...over,
  })
  return { host, children, log, call: text => host.call('echo', [text]) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('UtilityHost', () => {
  it('按需 fork：首次调用才启动，onStart 先于调用消息，结果按 id 配对', async () => {
    const { host, call, children, log } = setup()
    expect(log).toEqual([])
    expect(host.running).toBe(false)
    const a = call('a')
    const b = call('b')
    expect(log).toEqual(['fork 1', 'start 1'])
    expect(children[0].inbox.map(m => m.kind)).toEqual([
      'subscribe',
      'call',
      'call',
    ])
    children[0].reply(1)
    children[0].reply(0)
    await expect(a).resolves.toBe('A')
    await expect(b).resolves.toBe('B')
    expect(children).toHaveLength(1)
  })

  it('子进程报错：带上子进程给的 code 拒绝', async () => {
    const { call, children } = setup()
    const p = call('x')
    children[0].reply(0, false, 'not-found')
    await expect(p).rejects.toMatchObject({
      name: 'UtilityCallError',
      message: 'X',
      code: 'not-found',
    })
  })

  it('崩溃：挂起调用以 unavailable 失败；不立即重启，下次调用才 fork 新进程', async () => {
    const { host, call, children, log } = setup()
    const hanging = call('a')
    children[0].exit(3)
    const error = await hanging.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UtilityCallError)
    expect(error).toMatchObject({
      message: '测试进程已退出（code 3）',
      code: 'unavailable',
    })
    expect(host.running).toBe(false)
    expect(log).toEqual(['fork 1', 'start 1'])
    const next = call('b')
    expect(log).toEqual(['fork 1', 'start 1', 'fork 2', 'start 2'])
    children[1].reply(0)
    await expect(next).resolves.toBe('B')
  })

  it('ready：只报当前进程的 fork → ready 耗时，ready 不当事件', () => {
    const { host, children, log } = setup()
    host.start()
    children[0].send({ kind: 'ready' })
    children[0].send({ kind: 'event', channel: 'x:hi', payload: 1 })
    expect(log).toEqual(['fork 1', 'start 1', 'ready 7', 'event x:hi 1'])
  })

  it('start() 已在运行时不重复 fork', () => {
    const { host, log } = setup()
    host.start()
    host.start()
    expect(log).toEqual(['fork 1', 'start 1'])
  })

  it('关停：发关停消息，退出即完成；挂起调用以「已关停」失败', async () => {
    const { host, call, children } = setup()
    const p = call('a')
    p.catch(() => {})
    const done = host.stop()
    expect(children[0].inbox.at(-1)).toEqual({ kind: 'shutdown' })
    expect(host.running).toBe(false)
    children[0].exit(0)
    await done
    await expect(p).rejects.toThrow('测试进程已关停')
    expect(children[0].kills).toBe(0)
  })

  it('关停超时：stopTimeoutMs 到点 kill', async () => {
    const { host, children } = setup({ stopTimeoutMs: 2_000 })
    host.start()
    const done = host.stop()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(children[0].kills).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(children[0].kills).toBe(1)
  })

  it('关停中来的调用 / start()：等旧进程退完才 fork 新的', async () => {
    const { host, call, children, log } = setup()
    host.start()
    const done = host.stop()
    const next = call('b')
    host.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toEqual(['fork 1', 'start 1'])
    children[0].exit(0)
    await done
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toEqual(['fork 1', 'start 1', 'fork 2', 'start 2'])
    children[1].reply(0)
    await expect(next).resolves.toBe('B')
  })

  it('关停中的旧进程的事件照常交给 onEvent，但不算 ready、不算忙', async () => {
    const { host, call, children, log } = setup({ idleMs: 1_000 })
    host.start()
    void host.stop()
    children[0].send({ kind: 'ready' })
    children[0].send({ kind: 'event', channel: 'x:late', payload: 2 })
    children[0].send({ kind: 'busy', busy: true })
    expect(log).toEqual(['fork 1', 'start 1', 'event x:late 2'])
    children[0].exit(0)
    await vi.advanceTimersByTimeAsync(0)
    const p = call('a')
    children[1].reply(0)
    await p
    await vi.advanceTimersByTimeAsync(1_000)
    expect(children[1].inbox.at(-1)).toEqual({ kind: 'shutdown' })
  })

  it('代办：按方法表执行并回给发请求的子进程；不在表里的回「未知主进程能力」', async () => {
    const { host, children } = setup({
      host: {
        dir: async (sub: string) => `/data/${sub}`,
        boom: async () => {
          throw new Error('坏了')
        },
      },
    })
    host.start()
    children[0].send({ kind: 'host', id: 5, method: 'dir', args: ['x'] })
    children[0].send({ kind: 'host', id: 6, method: 'nope', args: [] })
    children[0].send({ kind: 'host', id: 7, method: 'boom', args: [] })
    await vi.advanceTimersByTimeAsync(0)
    expect(children[0].inbox.filter(m => m.kind === 'reply')).toEqual([
      {
        kind: 'reply',
        id: 6,
        ok: false,
        error: { message: '未知主进程能力：nope' },
      },
      { kind: 'reply', id: 5, ok: true, value: '/data/x' },
      { kind: 'reply', id: 7, ok: false, error: { message: 'Error: 坏了' } },
    ])
  })

  it('空闲退出：没挂起调用且不忙时 idleMs 后关停；忙或有调用时不计时', async () => {
    const { host, call, children } = setup({ idleMs: 1_000 })
    const p = call('a')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(host.running).toBe(true)
    children[0].reply(0)
    await p
    children[0].send({ kind: 'busy', busy: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(host.running).toBe(true)
    children[0].send({ kind: 'busy', busy: false })
    await vi.advanceTimersByTimeAsync(999)
    expect(host.running).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(host.running).toBe(false)
    expect(children[0].inbox.at(-1)).toEqual({ kind: 'shutdown' })
  })

  it('不给 idleMs 时不空闲退出', async () => {
    const { host, call, children } = setup()
    const p = call('a')
    children[0].reply(0)
    await p
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(host.running).toBe(true)
  })
})
