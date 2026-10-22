/**
 * 媒体库引擎崩溃重启后，渲染进程的事件订阅自动恢复。
 *
 * 链路全部用真实实现，只把进程边界换成同进程的假货：
 * - 宿主：src/main/library/engine-host.ts（主进程逻辑原样）；
 * - 引擎：FakeEngine 按 engine/entry.ts 的消息分派包一个真的 LibraryService（临时文件库）；
 * - 端口：node:worker_threads 的 MessageChannel（与 Electron 一样，进程死了引擎端随之关闭）；
 * - 渲染端：src/preload/library-bridge.ts（preload 逻辑原样），ipcRenderer 由 FakeIpc 接到宿主上。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type LibraryChild,
  LibraryEngineHost,
} from '../../../src/main/library/engine-host'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import {
  type EventPort,
  type LibraryIpc,
  createLibraryBridge,
} from '../../../src/preload/library-bridge'
import {
  LIBRARY_CHANNELS,
  type LibraryBridge,
  type LibraryEvent,
} from '../../../src/shared/library/ipc'
import type {
  FromUtility,
  ToUtility,
} from '../../../src/shared/utility/protocol'
import { tempTree } from './helpers'

/** 同进程的「引擎进程」：消息分派与 engine/entry.ts 一致。 */
class FakeEngine implements LibraryChild {
  readonly service: LibraryService
  private readonly ports: MessagePort[] = []
  private readonly listeners = {
    message: [] as Array<(m: FromUtility) => void>,
    exit: [] as Array<(c: number) => void>,
  }
  readonly requests: string[] = []
  dead = false

  constructor(dbPath: string) {
    this.service = new LibraryService({ dbPath, watch: false })
  }

  on(event: 'message', listener: (message: FromUtility) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'message' | 'exit', listener: never): void {
    ;(this.listeners[event] as unknown[]).push(listener)
  }

  postMessage(message: ToUtility, transfer: unknown[] = []): void {
    if (this.dead) return
    switch (message.kind) {
      case 'subscribe':
        for (const port of transfer as MessagePort[]) {
          const off = this.service.subscribe(event => port.postMessage(event))
          port.on('close', off)
          this.ports.push(port)
        }
        break
      case 'call':
        this.requests.push(message.method)
        void handleRpc(this.service, {
          method: message.method,
          params: message.args[0],
        }).then(outcome => {
          const result: FromUtility = outcome.ok
            ? {
                kind: 'result',
                id: message.id,
                ok: true,
                value: outcome.result,
              }
            : {
                kind: 'result',
                id: message.id,
                ok: false,
                error: outcome.error,
              }
          if (!this.dead) for (const l of this.listeners.message) l(result)
        })
        break
      case 'shutdown':
        void this.exit(0)
        break
    }
  }

  kill(): boolean {
    void this.exit(-1)
    return true
  }

  /** 模拟进程退出：库关闭、引擎端端口随进程失效、宿主收到 exit。 */
  async exit(code: number): Promise<void> {
    if (this.dead) return
    this.dead = true
    await this.service.queue.idle()
    await this.service.close()
    for (const port of this.ports) port.close()
    for (const l of this.listeners.exit) l(code)
  }
}

/** 把 preload 的 ipcRenderer 接到宿主上，等价于主进程 registerLibraryIpc 的接线。 */
function fakeIpc(
  host: LibraryEngineHost,
  windowId: number
): LibraryIpc & {
  sent: string[]
  delivered: MessagePort[]
} {
  let onPort: ((event: { ports: readonly unknown[] }) => void) | undefined
  const sent: string[] = []
  const delivered: MessagePort[] = []
  return {
    sent,
    delivered,
    async invoke(channel, method, params) {
      expect(channel).toBe(LIBRARY_CHANNELS.invoke)
      return host.invoke(method, params)
    },
    send(channel) {
      sent.push(channel)
      if (channel === LIBRARY_CHANNELS.subscribe) {
        host.subscribe(windowId, {
          deliver(port) {
            delivered.push(port as MessagePort)
            // webContents.postMessage 是异步投递
            setImmediate(() =>
              onPort?.({ ports: [port as unknown as EventPort] })
            )
          },
        })
      } else if (channel === LIBRARY_CHANNELS.unsubscribe) {
        host.unsubscribe(windowId)
      }
    },
    on(channel, listener) {
      expect(channel).toBe(LIBRARY_CHANNELS.port)
      onPort = listener
    },
  }
}

/** 等到 predicate 成立（端口消息是异步到达的）。 */
async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`等待超时：${what}`)
}

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 30))

describe('媒体库引擎重启后事件订阅自动恢复', () => {
  let dir: string
  let tree: ReturnType<typeof tempTree>
  let engines: FakeEngine[]
  let host: LibraryEngineHost
  let ipc: ReturnType<typeof fakeIpc>
  let api: LibraryBridge
  let events: LibraryEvent[]
  let off: () => void

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yb-resub-'))
    tree = tempTree()
    engines = []
    host = new LibraryEngineHost({
      fork: () => {
        const engine = new FakeEngine(join(dir, 'library.db'))
        void engine.service.start()
        engines.push(engine)
        return engine
      },
      createChannel: () => new MessageChannel(),
    })
    ipc = fakeIpc(host, 1)
    api = createLibraryBridge(ipc)
    events = []
    off = api.subscribe(event => events.push(event))
  })

  afterEach(async () => {
    off()
    for (const engine of engines) await engine.exit(0)
    for (const port of ipc.delivered) port.close()
    tree.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const types = (): string[] =>
    events.map(e => (e.type === 'job' ? `job:${e.jobType}:${e.state}` : e.type))

  it('崩溃 → 下一次调用重启 → 新引擎的扫描事件照常到达渲染层', async () => {
    tree.write('Alien (1979)/Alien (1979).mkv')
    const lib = await api.addLibrary({ root: tree.root, kind: 'movie' })
    await until(() => types().includes('job:scan:done'), '首次扫描完成事件')
    expect(engines).toHaveLength(1)

    await engines[0].exit(1) // 引擎崩溃
    expect(host.running).toBe(false)
    events.length = 0

    tree.write('Aliens (1986)/Aliens (1986).mkv')
    await api.scan({ libraryId: lib.id })
    expect(engines).toHaveLength(2)
    await until(() => types().includes('job:scan:done'), '重启后扫描完成事件')
    expect(types()).toContain('items-changed')
    // 订阅只登记过一次：恢复靠主进程重新下发端口，不靠渲染层重发 subscribe
    expect(ipc.sent).toEqual([LIBRARY_CHANNELS.subscribe])
    expect(ipc.delivered).toHaveLength(2)
  })

  it('新端口在触发重启的调用之前接上：这次调用一开始的事件也不丢', async () => {
    await api.listLibraries()
    await engines[0].exit(1)
    events.length = 0

    tree.write('Up (2009)/Up (2009).mkv')
    await api.addLibrary({ root: tree.root, kind: 'movie' })
    await until(() => types().includes('job:scan:done'), '扫描完成事件')
    // 扫描任务的第一个事件 queued 在 addLibrary 处理过程中同步发出
    expect(types()[0]).toBe('job:scan:queued')
  })

  it('崩溃后不因为有订阅方就立刻重启（启动即崩不会反复 fork）', async () => {
    await api.listLibraries()
    await engines[0].exit(1)
    await flush()
    expect(engines).toHaveLength(1)
    expect(host.running).toBe(false)
  })

  it('旧引擎的端口被换下并关闭，事件不会重复投递', async () => {
    tree.write('Up (2009)/Up (2009).mkv')
    await api.listLibraries()
    await engines[0].exit(1)
    await api.addLibrary({ root: tree.root, kind: 'movie' })
    await until(() => types().includes('job:scan:done'), '扫描完成事件')
    const done = types().filter(t => t === 'job:scan:done')
    expect(done).toHaveLength(1)
  })

  it('退订后引擎重启不再下发端口；同一窗口再订阅（刷新）只保留一份登记', async () => {
    await api.listLibraries()
    off()
    expect(ipc.sent).toEqual([
      LIBRARY_CHANNELS.subscribe,
      LIBRARY_CHANNELS.unsubscribe,
    ])
    await engines[0].exit(1)
    await api.listLibraries()
    expect(ipc.delivered).toHaveLength(1)

    off = api.subscribe(event => events.push(event))
    expect(ipc.delivered).toHaveLength(2)

    // 窗口刷新：同一个键重新登记，替换掉旧页面的登记
    const reloaded: MessagePort[] = []
    host.subscribe(1, {
      deliver: port => void reloaded.push(port as MessagePort),
    })
    await engines[1].exit(1)
    await api.listLibraries()
    expect(ipc.delivered).toHaveLength(2)
    expect(reloaded).toHaveLength(2)
    for (const port of reloaded) port.close()
  })
})

describe('preload bridge：端口替换', () => {
  /** 记录 close / start 的假端口。 */
  function fakePort(): EventPort & { closed: boolean; started: boolean } {
    return {
      onmessage: null,
      closed: false,
      started: false,
      start() {
        this.started = true
      },
      close() {
        this.closed = true
      },
    }
  }

  function setup(): {
    api: LibraryBridge
    push: (port: EventPort) => void
    sent: string[]
  } {
    let onPort: ((event: { ports: readonly unknown[] }) => void) | undefined
    const sent: string[] = []
    const api = createLibraryBridge({
      invoke: async () => ({ ok: true, result: null }),
      send: channel => void sent.push(channel),
      on: (_channel, listener) => {
        onPort = listener
      },
    })
    return { api, push: port => onPort!({ ports: [port] }), sent }
  }

  it('收到新端口：关掉旧端口，监听者改从新端口收事件', () => {
    const { api, push } = setup()
    const received: LibraryEvent[] = []
    api.subscribe(e => received.push(e))
    const first = fakePort()
    const second = fakePort()
    push(first)
    push(second)
    expect(first.closed).toBe(true)
    expect(second.started).toBe(true)
    const event: LibraryEvent = { type: 'libraries-changed', libraries: [] }
    second.onmessage!({ data: event })
    expect(received).toEqual([event])
  })

  it('没有监听者时收到的端口直接关闭；最后一个监听者离开时关端口并退订', () => {
    const { api, push, sent } = setup()
    const stray = fakePort()
    push(stray)
    expect(stray.closed).toBe(true)

    const a = api.subscribe(() => {})
    const b = api.subscribe(() => {})
    expect(sent).toEqual([LIBRARY_CHANNELS.subscribe])
    const port = fakePort()
    push(port)
    a()
    expect(port.closed).toBe(false)
    b()
    b()
    expect(port.closed).toBe(true)
    expect(sent).toEqual([
      LIBRARY_CHANNELS.subscribe,
      LIBRARY_CHANNELS.unsubscribe,
    ])
  })
})
