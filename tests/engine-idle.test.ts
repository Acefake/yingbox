import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineHost } from '../src/main/engine/host'
import { type EngineContext, serveEngine } from '../src/engine/rpc'
import type { FromUtility, ToUtility } from '../src/shared/utility/protocol'
import { call, defineDomain, str } from '../src/shared/contract/define'

const demo = defineDomain('demo', {
  echo: call<[text: string], string>(a => [str(a[0], 'text')]),
  /** 模拟一次很久的搜索：等测试放行 */
  slow: call<string>(),
})

const MIN = 60_000

/**
 * 内存里接起宿主与引擎。引擎收到 shutdown 后过 `exitDelayMs` 退出；`ignoreShutdown` 模拟卡死
 * 不理会；kill() 立即退出。
 */
function wire(
  opts: { exitDelayMs?: number; ignoreShutdown?: boolean; idleMs?: number } = {}
): {
  host: EngineHost
  forks: () => number
  kills: () => number
  ctx: () => EngineContext
  crash: () => void
  release: () => void
  log: string[]
} {
  let forks = 0
  let kills = 0
  let ctx: EngineContext | undefined
  let exit: () => void = () => {}
  let release: () => void = () => {}
  const log: string[] = []
  const host = new EngineHost({
    idleMs: opts.idleMs,
    broadcast: () => {},
    hostMethods: {
      browserFetch: async () => '',
      resetBrowserFetch: async () => {},
      downloadDir: async () => '/tmp',
      tmdbToken: async () => '',
      tmdbLanguage: async () => 'zh-CN',
    },
    fork: () => {
      const n = ++forks
      log.push(`fork ${n}`)
      const toHost: Array<(m: FromUtility) => void> = []
      const toEngine: Array<(e: { data: ToUtility }) => void> = []
      const exits: Array<(code: number) => void> = []
      let alive = true
      const die = (code: number): void => {
        if (!alive) return
        alive = false
        log.push(`exit ${n}`)
        exits.forEach(l => l(code))
      }
      const server = serveEngine({
        postMessage: m =>
          queueMicrotask(() => alive && toHost.forEach(l => l(m))),
        on: (_e, l) => toEngine.push(l),
      })
      server.implement(demo, {
        echo: (_c, text) => `${text}@${n}`,
        slow: () =>
          new Promise<string>(resolve => {
            release = () => resolve('done')
          }),
      })
      server.onShutdown(() => {
        log.push(`shutdown ${n}`)
        if (opts.ignoreShutdown) return
        if (opts.exitDelayMs) setTimeout(() => die(0), opts.exitDelayMs)
        else queueMicrotask(() => die(0))
      })
      ctx = server.context
      exit = () => die(1)
      return {
        postMessage: m =>
          queueMicrotask(() => alive && toEngine.forEach(l => l({ data: m }))),
        on: (e: string, l: (x: never) => void) => {
          if (e === 'message') toHost.push(l as (m: FromUtility) => void)
          else exits.push(l as (code: number) => void)
        },
        kill: () => {
          kills++
          log.push(`kill ${n}`)
          die(-1)
          return true
        },
      }
    },
  })
  return {
    host,
    forks: () => forks,
    kills: () => kills,
    ctx: () => ctx!,
    crash: () => exit(),
    release: () => release(),
    log,
  }
}

/** 推进假时钟并让微任务（内存端口的消息）跑完 */
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('后台引擎空闲退出', () => {
  it('最后一次调用后 5 分钟无调用即退出；期间的调用重新计时', async () => {
    const { host, log } = wire()
    await expect(host.invoke('demo:echo', ['a'])).resolves.toBe('a@1')
    await advance(4 * MIN)
    await host.invoke('demo:echo', ['b'])
    await advance(4 * MIN)
    expect(host.running).toBe(true)
    expect(log).not.toContain('shutdown 1')
    await advance(1 * MIN)
    expect(log).toEqual(['fork 1', 'shutdown 1', 'exit 1'])
    expect(host.running).toBe(false)
  })

  it('有下载在跑或排队（引擎报忙）时绝不退出；忙完再空闲 5 分钟才退出', async () => {
    const { host, ctx, log } = wire()
    await host.invoke('demo:echo', ['a'])
    ctx().busy(true)
    await advance(60 * MIN)
    expect(log).toEqual(['fork 1'])
    ctx().busy(false)
    await advance(5 * MIN - 1)
    expect(log).toEqual(['fork 1'])
    await advance(1)
    expect(log).toEqual(['fork 1', 'shutdown 1', 'exit 1'])
  })

  it('有挂起的调用（正在搜索）时绝不退出；调用结束后再计时', async () => {
    const { host, release, log } = wire()
    const slow = host.invoke('demo:slow', [])
    // 搜索进行中别的调用先回来了：不能因此开始计时
    await expect(host.invoke('demo:echo', ['a'])).resolves.toBe('a@1')
    await advance(30 * MIN)
    expect(log).toEqual(['fork 1'])
    release()
    await expect(slow).resolves.toBe('done')
    await advance(5 * MIN)
    expect(log).toEqual(['fork 1', 'shutdown 1', 'exit 1'])
  })

  it('退出后再调用自动拉起新引擎', async () => {
    const { host, forks } = wire()
    await host.invoke('demo:echo', ['a'])
    await advance(5 * MIN)
    expect(host.running).toBe(false)
    await expect(host.invoke('demo:echo', ['b'])).resolves.toBe('b@2')
    expect(forks()).toBe(2)
  })

  it('关停中来了调用：等旧进程退完才 fork 新的，两个引擎不同时在跑', async () => {
    const { host, log } = wire({ exitDelayMs: 1000 })
    await host.invoke('demo:echo', ['a'])
    await advance(5 * MIN)
    expect(log).toEqual(['fork 1', 'shutdown 1'])
    const next = host.invoke('demo:echo', ['b'])
    await advance(500)
    expect(log).toEqual(['fork 1', 'shutdown 1'])
    await advance(500)
    await expect(next).resolves.toBe('b@2')
    expect(log).toEqual(['fork 1', 'shutdown 1', 'exit 1', 'fork 2'])
  })

  it('关停超时（引擎不理 shutdown）直接 kill；之后的调用照常拉起', async () => {
    const { host, kills, log } = wire({ ignoreShutdown: true })
    await host.invoke('demo:echo', ['a'])
    await advance(5 * MIN)
    await advance(4_999)
    expect(kills()).toBe(0)
    await advance(1)
    expect(kills()).toBe(1)
    expect(log).toEqual(['fork 1', 'shutdown 1', 'kill 1', 'exit 1'])
    await expect(host.invoke('demo:echo', ['b'])).resolves.toBe('b@2')
  })

  it('应用退出时关停：挂起的调用失败，超时 kill，不会拖住退出', async () => {
    const { host, kills } = wire({ ignoreShutdown: true })
    const slow = host.invoke('demo:slow', [])
    slow.catch(() => {})
    await advance(0)
    const done = host.shutdown()
    await advance(5_000)
    await done
    expect(kills()).toBe(1)
    await expect(slow).rejects.toThrow('关停')
  })

  it('引擎崩溃时忙碌状态复位：重启后的引擎照常空闲退出', async () => {
    const { host, ctx, crash, log } = wire()
    await host.invoke('demo:echo', ['a'])
    ctx().busy(true)
    await advance(0)
    crash()
    await host.invoke('demo:echo', ['b'])
    await advance(5 * MIN)
    expect(log).toEqual(['fork 1', 'exit 1', 'fork 2', 'shutdown 2', 'exit 2'])
  })

  it('关停中的旧进程发来的忙碌消息不算到新进程头上', async () => {
    const { host, ctx, log } = wire({ exitDelayMs: 1000 })
    await host.invoke('demo:echo', ['a'])
    await advance(5 * MIN)
    ctx().busy(true) // 旧进程收尾时还在发消息
    const next = host.invoke('demo:echo', ['b'])
    await advance(1000)
    await expect(next).resolves.toBe('b@2')
    await advance(5 * MIN)
    expect(log.filter(l => l.startsWith('shutdown'))).toEqual([
      'shutdown 1',
      'shutdown 2',
    ])
  })

  it('idleMs 为 0 时不空闲退出', async () => {
    const { host, log } = wire({ idleMs: 0 })
    await host.invoke('demo:echo', ['a'])
    await advance(60 * MIN)
    expect(log).toEqual(['fork 1'])
  })
})

describe('引擎侧：下载队列报告忙碌', () => {
  it('有任务在跑或排队时报忙，全部结束（成功或失败）报闲，状态不变不重复报', async () => {
    vi.useRealTimers()
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createNetClient } = await import('../src/shared/net/client')
    const { createDownloadHandlers } =
      await import('../src/engine/download/index')
    const root = await mkdtemp(join(tmpdir(), 'yb-busy-'))
    const busy: boolean[] = []
    const { queue } = createDownloadHandlers({
      net: createNetClient({
        lookup: async () => [{ address: '93.184.216.34' }],
        fetch: async () => new Response('nf', { status: 404 }),
      }),
      stateFile: join(root, 'queue.json'),
      ctx: {
        emit: () => {},
        busy: b => busy.push(b),
        host: (async () => root) as never,
      },
    })
    queue.add('a-1')
    queue.add('b-2')
    await vi.waitFor(() => expect(queue.snapshot().failed).toHaveLength(2))
    expect(busy).toEqual([true, false])
    queue.add('c-3')
    await vi.waitFor(() => expect(queue.snapshot().failed).toHaveLength(3))
    expect(busy).toEqual([true, false, true, false])
  })
})
