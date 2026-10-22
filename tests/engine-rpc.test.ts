import { describe, expect, it } from 'vitest'
import { EngineHost, forwardTo } from '../src/main/engine/host'
import { serveEngine } from '../src/engine/rpc'
import type { FromEngine, ToEngine } from '../src/engine/protocol'
import { call, defineDomain, event, str } from '../src/shared/contract/define'

const demo = defineDomain(
  'demo',
  {
    echo: call<[text: string], string>(a => [str(a[0], 'text')]),
    boom: call<void>(),
    viaHost: call<[url: string], string>(a => [str(a[0], 'url')]),
  },
  { tick: event<number>() }
)

/** 用内存端口把宿主与引擎接在一起；exit() 模拟引擎崩溃 */
function wire(): {
  host: EngineHost
  broadcasts: Array<[string, unknown]>
  forks: () => number
  crash: (code: number) => void
} {
  const broadcasts: Array<[string, unknown]> = []
  let forks = 0
  let crash: (code: number) => void = () => {}
  const host = new EngineHost({
    broadcast: (channel, payload) => broadcasts.push([channel, payload]),
    hostMethods: {
      browserFetch: async url => `<html>${url}</html>`,
      resetBrowserFetch: async () => {},
      downloadDir: async () => '/tmp',
      tmdbToken: async () => '',
    },
    fork: () => {
      forks++
      const toHost: Array<(m: FromEngine) => void> = []
      const toEngine: Array<(e: { data: ToEngine }) => void> = []
      const exits: Array<(code: number) => void> = []
      const server = serveEngine({
        postMessage: m => queueMicrotask(() => toHost.forEach(l => l(m))),
        on: (_e, l) => toEngine.push(l),
      })
      server.implement(demo, {
        echo: (ctx, text) => {
          ctx.emit(demo, 'tick', text.length)
          return text.toUpperCase()
        },
        boom: () => {
          throw new Error('引擎内部错误')
        },
        viaHost: (ctx, url) => ctx.host('browserFetch', url),
      })
      crash = code => exits.forEach(l => l(code))
      return {
        postMessage: m =>
          queueMicrotask(() => toEngine.forEach(l => l({ data: m }))),
        on: (e: string, l: (x: never) => void) => {
          if (e === 'message') toHost.push(l as (m: FromEngine) => void)
          else exits.push(l as (code: number) => void)
        },
        kill: () => true,
      }
    },
  })
  return {
    host,
    broadcasts,
    forks: () => forks,
    crash: (c: number) => crash(c),
  }
}

describe('引擎 RPC（主进程宿主 ⇄ 引擎）', () => {
  it('转发调用、拿回结果，引擎事件经宿主广播', async () => {
    const { host, broadcasts } = wire()
    const handlers = forwardTo(host, demo)
    await expect(handlers.echo({ sender: {} as never }, 'abc')).resolves.toBe(
      'ABC'
    )
    expect(broadcasts).toEqual([['demo:tick', 3]])
  })

  it('引擎抛错变成调用方的 reject', async () => {
    const { host } = wire()
    await expect(host.invoke('demo:boom', [])).rejects.toThrow('引擎内部错误')
  })

  it('引擎可以请主进程代办（浏览器代抓）', async () => {
    const { host } = wire()
    await expect(host.invoke('demo:viaHost', ['https://a.test'])).resolves.toBe(
      '<html>https://a.test</html>'
    )
  })

  it('按需启动：首次调用才 fork；崩溃时挂起调用失败，下次调用自动重启', async () => {
    const { host, forks, crash } = wire()
    expect(forks()).toBe(0)
    await host.invoke('demo:echo', ['x'])
    expect(forks()).toBe(1)
    const hanging = host.invoke('demo:viaHost', ['never'])
    crash(1)
    await expect(hanging).rejects.toThrow('已退出')
    await host.invoke('demo:echo', ['y'])
    expect(forks()).toBe(2)
  })

  it('引擎注册时漏实现直接报错', () => {
    const server = serveEngine({ postMessage: () => {}, on: () => {} })
    expect(() => server.implement(demo, { echo: () => '' } as never)).toThrow(
      '缺少实现'
    )
  })
})
