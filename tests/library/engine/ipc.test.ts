import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  type InvokeResult,
  LIBRARY_CHANNELS,
  LIBRARY_METHODS,
  type LibraryEvent,
  type LibraryRpcMap,
  MAX_PAGE_SIZE,
  libraryErrorCode,
  normalizeLibraryQuery,
} from '../../../src/shared/library/ipc'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import {
  type EventPort,
  createLibraryBridge,
} from '../../../src/preload/library-bridge'
import { tempTree } from './helpers'

describe('normalizeLibraryQuery', () => {
  it('缺省：电影 + 剧集、片名升序、每页 200', () => {
    expect(normalizeLibraryQuery(undefined)).toEqual({
      libraryId: undefined,
      source: undefined,
      types: ['movie', 'series'],
      search: undefined,
      yearFrom: undefined,
      yearTo: undefined,
      matchStates: undefined,
      sort: 'title',
      order: 'asc',
      offset: 0,
      limit: DEFAULT_PAGE_SIZE,
    })
  })

  it('非片名排序默认降序；limit 封顶；搜索词去空白', () => {
    const q = normalizeLibraryQuery({
      sort: 'addedAt',
      limit: 99999,
      search: '  流浪地球 ',
    })
    expect(q).toMatchObject({
      order: 'desc',
      limit: MAX_PAGE_SIZE,
      search: '流浪地球',
    })
  })

  it.each([
    [{ sort: 'size' }],
    [{ limit: 0 }],
    [{ offset: -1 }],
    [{ types: ['episode'] }],
    [{ libraryId: 1.5 }],
    [{ search: 42 }],
    [{ source: 'imdb' }],
    ['not an object'],
  ])('非法参数 %j 抛 invalid-params', input => {
    expect(() => normalizeLibraryQuery(input)).toThrow(
      expect.objectContaining({ code: 'invalid-params' })
    )
  })
})

describe('引擎 RPC 与 preload bridge', () => {
  let tree: ReturnType<typeof tempTree>
  let service: LibraryService
  beforeEach(async () => {
    tree = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    tree.cleanup()
  })

  /** 用真实服务实现的假 ipcRenderer：invoke 直接走 handleRpc，等价于主进程转发。 */
  function fakeIpc(): {
    invoke: (
      channel: string,
      method: unknown,
      params: unknown
    ) => Promise<InvokeResult>
    send: (channel: string) => void
    on: (
      channel: string,
      listener: (event: { ports: readonly unknown[] }) => void
    ) => void
    sent: string[]
    pushPort: (port: EventPort) => void
  } {
    const sent: string[] = []
    let onPort: ((event: { ports: readonly unknown[] }) => void) | undefined
    return {
      sent,
      pushPort: port => onPort?.({ ports: [port] }),
      async invoke(channel, method, params) {
        expect(channel).toBe(LIBRARY_CHANNELS.invoke)
        return handleRpc(service, { method, params })
      },
      send(channel) {
        sent.push(channel)
      },
      on(channel, listener) {
        expect(channel).toBe(LIBRARY_CHANNELS.port)
        onPort = listener
      },
    }
  }

  it('白名单与契约方法一一对应', () => {
    const methods: Array<keyof LibraryRpcMap> = [
      'listLibraries',
      'addLibrary',
      'removeLibrary',
      'updateLibrary',
      'scan',
      'query',
      'getItem',
      'getPreview',
      'identify',
      'getMatchCandidates',
      'applyMatch',
      'lockMatch',
      'unlockMatch',
      'refreshMetadata',
      'setProviderToken',
      'getProviderStatus',
      'notifyChanges',
      'writer.getSettings',
      'writer.setSettings',
      'writer.write',
      'writer.previewOrganize',
      'writer.applyOrganize',
      'writer.undoOrganize',
      'writer.listOrganizeBatches',
      'facets.list',
      'jav.getSettings',
      'jav.setSettings',
      'actors.list',
      'actors.get',
      'actors.forItem',
      'actors.update',
      'actors.refresh',
      'actors.cancelRefresh',
      'actors.getSettings',
      'actors.setSettings',
    ]
    expect([...LIBRARY_METHODS].sort()).toEqual(methods.sort())
  })

  it('未知方法与非法参数返回带错误码的失败响应，不抛出', async () => {
    expect(
      await handleRpc(service, { method: 'dropTables', params: {} })
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unknown-method' }),
    })
    const bad = await handleRpc(service, {
      method: 'getItem',
      params: { itemId: 'x' },
    })
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid-params' } })
  })

  it('bridge：增库 → 扫描 → 查询 → 详情，错误还原成带 code 的 Error', async () => {
    tree.write('Alien (1979)/Alien (1979).mkv')
    tree.write('Aliens (1986)/Aliens.1986.1080p.mkv')
    const api = createLibraryBridge(fakeIpc())

    const lib = await api.addLibrary({ root: tree.root, kind: 'movie' })
    expect(lib).toMatchObject({ kind: 'movie', lastScanAt: null })
    expect(lib).not.toHaveProperty('rootKey')
    await service.queue.idle()

    const page = await api.query()
    expect(page.items.map(i => i.title)).toEqual(['Alien', 'Aliens'])
    const detail = await api.getItem(page.items[1].id)
    expect(detail!.files[0].path).toContain('Aliens.1986.1080p.mkv')
    expect((await api.listLibraries())[0].lastScanAt).not.toBeNull()

    const conflict = await api
      .addLibrary({ root: tree.root, kind: 'tv' })
      .catch((e: Error) => e)
    expect(conflict).toMatchObject({ name: 'LibraryError', code: 'conflict' })
    // contextBridge 会丢掉 code 属性、只剩 message：从消息里也能取回错误码
    expect(libraryErrorCode(new Error((conflict as Error).message))).toBe(
      'conflict'
    )
    expect(libraryErrorCode(new Error('普通错误'))).toBeUndefined()
    await expect(api.scan({ libraryId: 999 })).rejects.toMatchObject({
      code: 'not-found',
    })
    expect(await api.getItem(424242)).toBeNull()

    await api.removeLibrary(lib.id)
    expect((await api.query()).total).toBe(0)
  })

  it('bridge.subscribe 发 library:subscribe 登记，主进程推来的端口收到的事件转给监听者', () => {
    const ipc = fakeIpc()
    const port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      started: false,
      closed: false,
      start() {
        this.started = true
      },
      close() {
        this.closed = true
      },
    }
    const api = createLibraryBridge(ipc)
    const received: LibraryEvent[] = []

    const unsubscribe = api.subscribe(e => received.push(e))
    ipc.pushPort(port)
    const event: LibraryEvent = { type: 'libraries-changed', libraries: [] }
    port.onmessage!({ data: event })
    unsubscribe()

    expect(ipc.sent).toEqual([
      LIBRARY_CHANNELS.subscribe,
      LIBRARY_CHANNELS.unsubscribe,
    ])
    expect(port.started).toBe(true)
    expect(received).toEqual([event])
    expect(port.closed).toBe(true)
  })

  it('服务事件：增库广播 libraries-changed，扫描广播任务进度与 items-changed', async () => {
    tree.write('Up (2009)/Up (2009).mkv')
    const events: LibraryEvent[] = []
    service.subscribe(e => events.push(e))
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    await service.queue.idle()

    const types = events.map(e =>
      e.type === 'job' ? `job:${e.jobType}:${e.state}` : e.type
    )
    expect(types[0]).toBe('job:scan:queued')
    expect(types).toContain('libraries-changed')
    expect(types).toContain('job:scan:done')
    const items = events.find(e => e.type === 'items-changed')
    expect(items).toMatchObject({ added: [expect.any(Number)], reset: false })
  })
})
