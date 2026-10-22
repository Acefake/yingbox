/**
 * 媒体库外部变更通知（主进程侧）：请求体格式（CloudDrive2 webhook 默认模板、通用 JSON）、
 * HTTP 端点（只认 POST /library/notify、令牌、体积上限、默认只监听 127.0.0.1）、
 * 端点生命周期（按设置启停、生成令牌、端口被占用换端口并写回、换令牌、挂载目录随通知带上）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest'
import { createNotifyController } from '../../src/main/library/notify/controller'
import {
  NotifyPayloadError,
  parseNotifyPayload,
} from '../../src/main/library/notify/payload'
import {
  NOTIFY_MAX_BODY,
  NOTIFY_PATH,
  type NotifyServer,
  startNotifyServer,
} from '../../src/main/library/notify/server'
import type { FileChangeNotice } from '../../src/shared/library/ipc'
import {
  type SettingChange,
  type SettingValues,
  defaultValues,
  parseSetting,
} from '../../src/shared/settings/schema'

/** CloudDrive2 webhook.toml 的 [file_system_watcher] 默认 body 模板填好占位符后的样子。 */
const cd2Body = (
  items: Array<{ action: string; source: string; dest?: string; dir?: boolean }>
): Record<string, unknown> => ({
  device_name: 'CloudDrive2',
  user_name: 'me@example.com',
  version: '0.9.8',
  event_category: 'file',
  event_name: 'notify',
  event_time: '1761100000',
  send_time: '1761100001',
  data: items.map(i => ({
    action: i.action,
    is_dir: i.dir ? 'true' : 'false',
    source_file: i.source,
    destination_file: i.dest ?? '',
  })),
})

describe('parseNotifyPayload', () => {
  it('CloudDrive2：create / modify / delete / rename，空 destination_file 丢掉', () => {
    expect(
      parseNotifyPayload(
        cd2Body([
          { action: 'create', source: '/115/电影/A (2001)/A.mkv' },
          { action: 'modify', source: '/115/电影/A (2001)/A.nfo' },
          { action: 'delete', source: '/115/电影/Old', dir: true },
          {
            action: 'rename',
            source: '/115/电影/x.mkv',
            dest: '/115/电影/y.mkv',
          },
        ])
      )
    ).toEqual([
      { action: 'create', path: '/115/电影/A (2001)/A.mkv' },
      { action: 'modify', path: '/115/电影/A (2001)/A.nfo' },
      { action: 'delete', path: '/115/电影/Old' },
      {
        action: 'rename',
        path: '/115/电影/x.mkv',
        destination: '/115/电影/y.mkv',
      },
    ])
  })

  it('CloudDrive2 挂载事件（mount_point，没有 source_file）与不认识的动作忽略', () => {
    expect(
      parseNotifyPayload({
        event_category: 'mount_point',
        data: [{ action: 'mount', mount_point: '/mnt/cd2', status: 'true' }],
      })
    ).toEqual([])
    expect(
      parseNotifyPayload(cd2Body([{ action: 'chmod', source: '/a' }]))
    ).toEqual([])
  })

  it('通用 JSON：单个对象或数组，destination_path 可选', () => {
    expect(
      parseNotifyPayload({ action: 'create', path: 'D:\\Movies\\A.mkv' })
    ).toEqual([{ action: 'create', path: 'D:\\Movies\\A.mkv' }])
    expect(
      parseNotifyPayload([
        { action: 'rename', path: '/a', destination_path: '/b' },
        { action: 'CREATE', path: '/c' },
      ])
    ).toEqual([
      { action: 'rename', path: '/a', destination: '/b' },
      { action: 'create', path: '/c' },
    ])
  })

  it('既不是 CloudDrive2 也不是通用格式：抛 NotifyPayloadError', () => {
    expect(() => parseNotifyPayload('hello')).toThrow(NotifyPayloadError)
    expect(() => parseNotifyPayload({ foo: 1 })).toThrow(NotifyPayloadError)
    expect(() => parseNotifyPayload([{ action: 'create' }])).toThrow(
      NotifyPayloadError
    )
  })
})

describe('startNotifyServer', () => {
  let server: NotifyServer | null = null
  afterEach(async () => {
    await server?.close()
    server = null
  })

  type OnChanges = (
    changes: FileChangeNotice[]
  ) => Promise<{ accepted: number; ignored: number }>

  const start = async (
    onChanges: OnChanges = vi.fn(async (changes: FileChangeNotice[]) => ({
      accepted: changes.length,
      ignored: 0,
    }))
  ): Promise<{ base: string; onChanges: OnChanges }> => {
    server = await startNotifyServer({
      host: '127.0.0.1',
      port: 0,
      token: 'secret-token-123',
      onChanges,
    })
    const base = `http://127.0.0.1:${server.port}`
    return { base, onChanges }
  }

  const post = (url: string, body: unknown, headers = {}): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  it('?token= 或 Bearer 都认；转给 onChanges 并回 { accepted, ignored }', async () => {
    const { base, onChanges } = await start()
    const body = cd2Body([{ action: 'create', source: '/115/电影/A.mkv' }])
    const res = await post(`${base}${NOTIFY_PATH}?token=secret-token-123`, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: 1, ignored: 0 })
    expect(onChanges).toHaveBeenCalledWith([
      { action: 'create', path: '/115/电影/A.mkv' },
    ])
    const bearer = await post(`${base}${NOTIFY_PATH}`, body, {
      authorization: 'Bearer secret-token-123',
    })
    expect(bearer.status).toBe(200)
  })

  it('令牌不对 / 没带 401，不调用 onChanges', async () => {
    const { base, onChanges } = await start()
    const body = { action: 'create', path: '/a' }
    expect((await post(`${base}${NOTIFY_PATH}?token=wrong`, body)).status).toBe(
      401
    )
    expect((await post(`${base}${NOTIFY_PATH}`, body)).status).toBe(401)
    expect(
      (
        await post(`${base}${NOTIFY_PATH}`, body, {
          authorization: 'Bearer secret-token-12',
        })
      ).status
    ).toBe(401)
    expect(onChanges).not.toHaveBeenCalled()
  })

  it('路径不对 404、不是 POST 405、不是 JSON / 格式不对 400、太大 413、没有可用条目 200 且不调用', async () => {
    const { base, onChanges } = await start()
    const q = '?token=secret-token-123'
    expect((await post(`${base}/other${q}`, {})).status).toBe(404)
    expect((await fetch(`${base}${NOTIFY_PATH}${q}`)).status).toBe(405)
    expect((await post(`${base}${NOTIFY_PATH}${q}`, '{oops')).status).toBe(400)
    expect((await post(`${base}${NOTIFY_PATH}${q}`, { foo: 1 })).status).toBe(
      400
    )
    const big = 'x'.repeat(NOTIFY_MAX_BODY + 1)
    expect((await post(`${base}${NOTIFY_PATH}${q}`, big)).status).toBe(413)
    const empty = await post(`${base}${NOTIFY_PATH}${q}`, cd2Body([]))
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ accepted: 0, ignored: 0 })
    expect(onChanges).not.toHaveBeenCalled()
  })

  it('引擎不可用（onChanges 抛错）503', async () => {
    const { base } = await start(async () => {
      throw new Error('媒体库引擎不可用')
    })
    const res = await post(`${base}${NOTIFY_PATH}?token=secret-token-123`, {
      action: 'create',
      path: '/a',
    })
    expect(res.status).toBe(503)
  })

  it('端口被占用时 reject 并带 EADDRINUSE', async () => {
    const { base } = await start()
    const port = Number(new URL(base).port)
    await expect(
      startNotifyServer({
        host: '127.0.0.1',
        port,
        token: 't',
        onChanges: vi.fn(),
      })
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})

describe('createNotifyController', () => {
  const controllers: Array<{ close(): Promise<void> }> = []
  const blockers: Array<ReturnType<typeof createServer>> = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.close()
    for (const b of blockers.splice(0)) await new Promise(r => b.close(r))
  })

  /** 设置存储替身：按 schema 校验，写入回调 onSet。 */
  interface FakeStore {
    values: SettingValues
    get: <K extends keyof SettingValues>(key: K) => SettingValues[K]
    set: Mock<(key: string, raw: unknown) => SettingChange>
  }

  const fakeStore = (patch: Partial<SettingValues>): FakeStore => {
    const values: SettingValues = { ...defaultValues(), ...patch }
    return {
      values,
      get: <K extends keyof SettingValues>(key: K) => values[key],
      set: vi.fn((key: string, raw: unknown) => {
        const change = parseSetting(key, raw)
        if (!change) throw new Error(`设置 ${key} 的值不合法`)
        ;(values as Record<string, unknown>)[change.key] = change.value
        return change
      }),
    }
  }

  /** 先占一个端口，返回端口号。 */
  const occupy = async (): Promise<number> => {
    const blocker = createServer()
    blockers.push(blocker)
    await new Promise<void>(r => blocker.listen(0, '127.0.0.1', r))
    return (blocker.address() as AddressInfo).port
  }

  const make = (
    store: FakeStore,
    extra = {}
  ): {
    c: ReturnType<typeof createNotifyController>
    notify: ReturnType<typeof vi.fn>
    statuses: unknown[]
  } => {
    const notify = vi.fn(async () => ({ accepted: 1, ignored: 0 }))
    const statuses: unknown[] = []
    const c = createNotifyController({
      store,
      notify,
      lanAddress: () => '192.168.1.20',
      newToken: () => 'tok0123456789abcdef',
      onStatus: s => statuses.push(s),
      ...extra,
    })
    controllers.push(c)
    return { c, notify, statuses }
  }

  it('默认关：不监听', async () => {
    const listen = vi.fn()
    const { c } = make(fakeStore({}), { listen })
    expect(await c.apply()).toEqual({ running: false, url: null, error: null })
    expect(listen).not.toHaveBeenCalled()
  })

  it('打开：生成令牌写回设置，只监听 127.0.0.1，地址带令牌；收到通知连同挂载目录转给引擎', async () => {
    const port = await occupy()
    await new Promise(r => blockers.pop()!.close(r)) // 拿一个此刻空闲的端口
    const store = fakeStore({
      'library.notify.enabled': true,
      'library.notify.port': port,
      'library.notify.mountRoot': '/mnt/cd2',
    })
    const { c, notify } = make(store)
    const status = await c.apply()
    expect(store.values['library.notify.token']).toBe('tok0123456789abcdef')
    expect(status).toEqual({
      running: true,
      url: `http://127.0.0.1:${port}${NOTIFY_PATH}?token=tok0123456789abcdef`,
      error: null,
    })
    const res = await fetch(status.url!, {
      method: 'POST',
      body: JSON.stringify({ action: 'create', path: '/115/电影/A.mkv' }),
    })
    expect(res.status).toBe(200)
    expect(notify).toHaveBeenCalledWith({
      changes: [{ action: 'create', path: '/115/电影/A.mkv' }],
      mountRoot: '/mnt/cd2',
    })
  })

  it('局域网访问：监听 0.0.0.0，地址写本机局域网 IP；设置不变时 apply 不重启', async () => {
    const listen = vi.fn(async () => ({ port: 47291, close: async () => {} }))
    const store = fakeStore({
      'library.notify.enabled': true,
      'library.notify.lan': true,
      'library.notify.token': 'abc',
    })
    const { c } = make(store, { listen })
    expect((await c.apply()).url).toBe(
      `http://192.168.1.20:47291${NOTIFY_PATH}?token=abc`
    )
    expect(listen).toHaveBeenCalledWith(
      expect.objectContaining({ host: '0.0.0.0', port: 47291, token: 'abc' })
    )
    await c.apply()
    expect(listen).toHaveBeenCalledTimes(1)
    store.values['library.notify.lan'] = false
    await c.apply()
    expect(listen).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: '127.0.0.1' })
    )
  })

  it('端口被占用：换系统挑的端口并写回设置', async () => {
    const busy = await occupy()
    const store = fakeStore({
      'library.notify.enabled': true,
      'library.notify.port': busy,
    })
    const { c } = make(store)
    const status = await c.apply()
    expect(status.running).toBe(true)
    const port = store.values['library.notify.port']
    expect(port).not.toBe(busy)
    expect(status.url).toContain(`:${port}${NOTIFY_PATH}`)
  })

  it('换令牌：旧地址 401、新地址可用；关掉后停止并广播', async () => {
    // 端口被占 → 换端口写回；之后换令牌照样在新端口上
    const store = fakeStore({
      'library.notify.enabled': true,
      'library.notify.port': await occupy(),
    })
    let n = 0
    const { c, statuses } = make(store, { newToken: () => `token-${++n}` })
    const first = await c.apply()
    const second = await c.resetToken()
    expect(second.url).toContain('token=token-2')
    const post = (url: string): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        body: JSON.stringify({ action: 'create', path: '/a' }),
      })
    expect((await post(first.url!)).status).toBe(401)
    expect((await post(second.url!)).status).toBe(200)
    store.values['library.notify.enabled'] = false
    expect(await c.apply()).toEqual({ running: false, url: null, error: null })
    expect(statuses.at(-1)).toEqual({ running: false, url: null, error: null })
    await expect(post(second.url!)).rejects.toThrow()
  })

  it('启动失败（非端口占用）：状态里写原因，不抛', async () => {
    const listen = vi.fn(async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })
    const { c } = make(
      fakeStore({
        'library.notify.enabled': true,
        'library.notify.token': 'x',
      }),
      { listen }
    )
    expect(await c.apply()).toEqual({
      running: false,
      url: null,
      error: '没有权限监听端口 47291',
    })
  })
})
