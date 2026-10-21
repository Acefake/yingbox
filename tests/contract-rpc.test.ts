import { beforeEach, describe, expect, it, vi } from 'vitest'

const windows: Array<{ webContents: FakeContents }> = []

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows },
  ipcMain: { handle: () => {} },
}))

import { emit, implement } from '../src/main/rpc'
import {
  call,
  defineDomain,
  event,
  int,
  str,
  syncCall,
} from '../src/shared/contract/define'

interface FakeContents {
  sent: Array<[string, unknown]>
  destroyed: boolean
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

function contents(destroyed = false): FakeContents {
  return {
    sent: [],
    destroyed,
    isDestroyed() {
      return this.destroyed
    },
    send(channel, payload) {
      this.sent.push([channel, payload])
    },
  }
}

type IpcListener = (event: { sender: unknown }, ...args: unknown[]) => unknown
type IpcSyncListener = (
  event: { sender: unknown; returnValue: unknown },
  ...args: unknown[]
) => void

/** fakeIpc 的返回：ipcMain 的 handle / on 与渲染侧 invoke / sendSync 接在一起 */
interface FakeIpc {
  listeners: Map<string, IpcListener>
  syncListeners: Map<string, IpcSyncListener>
  handle(channel: string, listener: IpcListener): void
  on(channel: string, listener: IpcSyncListener): void
  sendSync(channel: string, ...args: unknown[]): unknown
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

/** ipcMain.handle 的替身：记下每个通道的 listener，测试里直接调用 */
function fakeIpc(): FakeIpc {
  const listeners = new Map<
    string,
    (event: { sender: unknown }, ...args: unknown[]) => unknown
  >()
  const syncListeners = new Map<
    string,
    (
      event: { sender: unknown; returnValue: unknown },
      ...args: unknown[]
    ) => void
  >()
  return {
    listeners,
    syncListeners,
    handle(
      channel: string,
      listener: (event: { sender: unknown }, ...args: unknown[]) => unknown
    ) {
      listeners.set(channel, listener)
    },
    /** ipcMain.on 的替身（同步调用）：返回 listener 写进 event.returnValue 的值 */
    on(
      channel: string,
      listener: (
        event: { sender: unknown; returnValue: unknown },
        ...args: unknown[]
      ) => void
    ) {
      syncListeners.set(channel, listener)
    },
    sendSync(channel: string, ...args: unknown[]): unknown {
      const listener = syncListeners.get(channel)
      if (!listener) throw new Error(`no sync handler for ${channel}`)
      const event = { sender: 'sender', returnValue: undefined as unknown }
      listener(event, ...args)
      return event.returnValue
    },
    invoke(channel: string, ...args: unknown[]) {
      const listener = listeners.get(channel)
      if (!listener) throw new Error(`no handler for ${channel}`)
      return Promise.resolve().then(() =>
        listener({ sender: 'sender' }, ...args)
      )
    },
  }
}

const demo = defineDomain(
  'demo',
  {
    echo: call<[text: string, times: number], string>(a => [
      str(a[0], 'text'),
      int(a[1], 'times'),
    ]),
    ping: call<string>(),
  },
  { tick: event<number>() }
)

describe('implement', () => {
  it('为每个调用注册「域名:键名」通道', () => {
    const ipc = fakeIpc()
    implement(
      demo,
      { echo: (_, text) => text, ping: () => 'pong' },
      ipc as never
    )
    expect([...ipc.listeners.keys()].sort()).toEqual(['demo:echo', 'demo:ping'])
  })

  it('合法入参原样交给处理函数，并带上发起方', async () => {
    const ipc = fakeIpc()
    const seen: unknown[] = []
    implement(
      demo,
      {
        echo: (ctx, text, times) => {
          seen.push(ctx.sender)
          return text.repeat(times)
        },
        ping: () => 'pong',
      },
      ipc as never
    )
    await expect(ipc.invoke('demo:echo', 'ab', 3)).resolves.toBe('ababab')
    await expect(ipc.invoke('demo:ping')).resolves.toBe('pong')
    expect(seen).toEqual(['sender'])
  })

  it('非法入参在边界被拒绝，错误带通道名与参数名，处理函数不会被调用', async () => {
    const ipc = fakeIpc()
    const echo = vi.fn(() => 'x')
    implement(demo, { echo, ping: () => 'pong' }, ipc as never)
    await expect(ipc.invoke('demo:echo', 42, 1)).rejects.toThrow(
      '[demo:echo] 参数 text 应为字符串'
    )
    await expect(ipc.invoke('demo:echo', 'a', 1.5)).rejects.toThrow(
      '参数 times 应为整数'
    )
    await expect(ipc.invoke('demo:echo', 'a')).rejects.toThrow(
      '参数 times 应为整数'
    )
    expect(echo).not.toHaveBeenCalled()
  })

  it('处理函数自己抛的错误原样传给渲染层', async () => {
    const ipc = fakeIpc()
    implement(
      demo,
      {
        echo: () => {
          throw new Error('boom')
        },
        ping: () => 'pong',
      },
      ipc as never
    )
    await expect(ipc.invoke('demo:echo', 'a', 1)).rejects.toThrow(/^boom$/)
  })

  it('漏实现时注册阶段就失败，且一个通道都不注册', () => {
    const ipc = fakeIpc()
    expect(() =>
      implement(demo, { echo: () => 'x' } as never, ipc as never)
    ).toThrow('[rpc] demo:ping 缺少实现')
    expect(ipc.listeners.size).toBe(0)
  })

  it('实现了契约里没有的键时注册失败', () => {
    const ipc = fakeIpc()
    expect(() =>
      implement(
        demo,
        { echo: () => 'x', ping: () => 'p', extra: () => 1 } as never,
        ipc as never
      )
    ).toThrow('[rpc] demo:extra 不在契约里')
    expect(ipc.listeners.size).toBe(0)
  })
})

describe('同步调用', () => {
  const boot = defineDomain(
    'boot',
    {
      snapshot: syncCall<{ theme: string }>(),
      twice: syncCall<[n: number], number>(a => [int(a[0], 'n')]),
    },
    {}
  )

  it('走 ipcMain.on 而不是 handle，返回值装进 { ok, value } 外壳', () => {
    const ipc = fakeIpc()
    implement(
      boot,
      { snapshot: () => ({ theme: 'dark' }), twice: (_, n) => n * 2 },
      ipc as never
    )
    expect(ipc.listeners.size).toBe(0)
    expect([...ipc.syncListeners.keys()].sort()).toEqual([
      'boot:snapshot',
      'boot:twice',
    ])
    expect(ipc.sendSync('boot:snapshot')).toEqual({
      ok: true,
      value: { theme: 'dark' },
    })
    expect(ipc.sendSync('boot:twice', 21)).toEqual({ ok: true, value: 42 })
  })

  it('非法入参与处理函数抛错都装成 { ok: false, error }，不会让 sendSync 挂起', () => {
    const ipc = fakeIpc()
    implement(
      boot,
      {
        snapshot: () => {
          throw new Error('boom')
        },
        twice: (_, n) => n,
      },
      ipc as never
    )
    expect(ipc.sendSync('boot:snapshot')).toEqual({ ok: false, error: 'boom' })
    expect(ipc.sendSync('boot:twice', 'x')).toEqual({
      ok: false,
      error: '[boot:twice] 参数 n 应为整数',
    })
  })
})

describe('emit', () => {
  beforeEach(() => {
    windows.length = 0
  })

  it('不指定目标时广播给所有未销毁的窗口', () => {
    const alive = contents()
    const dead = contents(true)
    windows.push({ webContents: alive }, { webContents: dead })
    emit(demo, 'tick', 7)
    expect(alive.sent).toEqual([['demo:tick', 7]])
    expect(dead.sent).toEqual([])
  })

  it('指定目标时只发给它', () => {
    const other = contents()
    const target = contents()
    windows.push({ webContents: other })
    emit(demo, 'tick', 1, target as never)
    expect(target.sent).toEqual([['demo:tick', 1]])
    expect(other.sent).toEqual([])
  })
})
