/**
 * 插件 $cache 持久化（src/engine/online/plugin-storage.ts）：
 * 跨调用共用、按插件隔离、重启后恢复、过期、大小上限、原子写。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SITES, createOnlineHandlers } from '../src/engine/online'
import { runCatSpider } from '../src/engine/online/catspider'
import {
  PLUGIN_STORAGE_TTL_MS,
  createPluginStorage,
  pluginStorageId,
} from '../src/engine/online/plugin-storage'
import type { EngineContext } from '../src/engine/rpc'
import { createNetClient } from '../src/shared/net/client'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'plugin-storage-'))
const A = 'https://plugins.test/a.js'
const B = 'https://plugins.test/b.js'
const fileOf = (dir: string, url: string): string =>
  join(dir, `${pluginStorageId(url)}.json`)

/** 瓜子式插件：没有 token 就“注册设备”（请求一次 /register），有就直接用。 */
const REGISTERING_PLUGIN = `
async function search() {
  let auth = $cache.get('auth')
  if (!auth) {
    const { data } = await $fetch.get('https://site.test/register')
    auth = jsonify({ token: data, n: 1 })
    $cache.set('auth', auth)
  }
  return jsonify({ token: argsify(auth).token })
}`

const net = (calls: string[]): ReturnType<typeof createNetClient> =>
  createNetClient({
    lookup: async () => [{ address: '93.184.216.34' }],
    fetch: async url => {
      calls.push(url)
      return new Response(`tok-${calls.length}`)
    },
  })

const ctx = {
  host: vi.fn(async () => ''),
  emit: vi.fn(),
} as unknown as EngineContext

describe('插件 $cache：跨调用与跨重启', () => {
  it('同一插件两次调用共用 $cache，只注册一次设备', async () => {
    const calls: string[] = []
    const h = createOnlineHandlers({
      net: net(calls),
      loadPlugin: async () => REGISTERING_PLUGIN,
    })
    const req = { action: 'search', siteName: SITES[0].name, keyword: 'x' }
    const first = await h.vod(ctx, req as never)
    const second = await h.vod(ctx, req as never)
    expect(first).toMatchObject({ success: true, data: { token: 'tok-1' } })
    expect(second).toMatchObject({ success: true, data: { token: 'tok-1' } })
    expect(calls).toEqual(['https://site.test/register'])
    // 另一个插件源有自己的 $cache，要自己注册
    const other = SITES.find(s => s.ext !== SITES[0].ext) as (typeof SITES)[0]
    const third = await h.vod(ctx, { ...req, siteName: other.name } as never)
    expect(third).toMatchObject({ data: { token: 'tok-2' } })
    expect(calls).toHaveLength(2)
  })

  it('落盘到 userData：引擎重启（新 handlers、同目录）后不再注册', async () => {
    const dir = tempDir()
    const calls: string[] = []
    const boot = (): ReturnType<typeof createOnlineHandlers> =>
      createOnlineHandlers({
        net: net(calls),
        loadPlugin: async () => REGISTERING_PLUGIN,
        pluginStorage: createPluginStorage({ dir }),
      })
    const req = { action: 'search', siteName: SITES[0].name, keyword: 'x' }
    await boot().vod(ctx, req as never)
    const after = await boot().vod(ctx, req as never)
    expect(after).toMatchObject({ data: { token: 'tok-1' } })
    expect(calls).toHaveLength(1)
    expect(existsSync(fileOf(dir, SITES[0].ext))).toBe(true)
  })

  it('不同插件互相隔离（各自一个文件）', async () => {
    const dir = tempDir()
    const storage = createPluginStorage({ dir })
    storage.forPlugin(A).set('k', 'a')
    storage.forPlugin(B).set('k', 'b')
    expect(storage.forPlugin(A).get('k')).toBe('a')
    expect(storage.forPlugin(B).get('k')).toBe('b')
    const reloaded = createPluginStorage({ dir })
    expect(reloaded.forPlugin(A).get('k')).toBe('a')
    expect(reloaded.forPlugin(B).get('k')).toBe('b')
    expect(readdirSync(dir).sort()).toEqual(
      [`${pluginStorageId(A)}.json`, `${pluginStorageId(B)}.json`].sort()
    )

    // runCatSpider 用注入的 cache；B 插件读不到 A 写的
    const calls: string[] = []
    const run = (url: string, code: string): Promise<unknown> =>
      runCatSpider(
        {
          net: net(calls),
          browserFetch: async () => '',
          loadPlugin: async () => code,
          cache: storage.forPlugin(url),
        },
        url,
        'search',
        {}
      )
    await run(
      A,
      `async function search() { $cache.set('only-a', 1); return {} }`
    )
    const seen = await run(
      B,
      `async function search() { return { v: $cache.get('only-a') ?? null } }`
    )
    expect(seen).toEqual({ v: null })
  })

  it('remove 落盘；删到空时删掉文件', () => {
    const dir = tempDir()
    const cache = createPluginStorage({ dir }).forPlugin(A)
    cache.set('x', 1)
    cache.set('y', 2)
    cache.remove('x')
    expect(createPluginStorage({ dir }).forPlugin(A).get('x')).toBeUndefined()
    expect(createPluginStorage({ dir }).forPlugin(A).get('y')).toBe(2)
    cache.remove('y')
    expect(existsSync(fileOf(dir, A))).toBe(false)
  })
})

describe('插件 $cache：过期与上限', () => {
  it('超过有效期读不到，重启后也读不到；重新 set 刷新写入时间', () => {
    const dir = tempDir()
    let clock = 1_000_000
    const now = (): number => clock
    const cache = createPluginStorage({ dir, now }).forPlugin(A)
    cache.set('old', 'v')
    clock += PLUGIN_STORAGE_TTL_MS - 1
    expect(cache.get('old')).toBe('v')
    cache.set('fresh', 'w')
    clock += 2
    expect(cache.get('old')).toBeUndefined()
    expect(cache.get('fresh')).toBe('w')
    const reloaded = createPluginStorage({ dir, now }).forPlugin(A)
    expect(reloaded.get('old')).toBeUndefined()
    expect(reloaded.get('fresh')).toBe('w')
    // 过期条目加载时就丢掉，下一次写盘不再带上它
    createPluginStorage({ dir, now }).forPlugin(A).set('x', 1)
    expect(
      Object.keys(JSON.parse(readFileSync(fileOf(dir, A), 'utf8')))
    ).toEqual(['x', 'fresh'])
  })

  it('每个插件按上限淘汰最早写入的；文件不超过上限', () => {
    const dir = tempDir()
    let clock = Date.now()
    const cache = createPluginStorage({
      dir,
      maxBytes: 1024,
      now: () => clock++,
    }).forPlugin(A)
    for (let i = 0; i < 40; i++) cache.set(`k${i}`, 'x'.repeat(50))
    expect(statSync(fileOf(dir, A)).size).toBeLessThanOrEqual(1024)
    const reloaded = createPluginStorage({ dir, maxBytes: 1024 }).forPlugin(A)
    expect(reloaded.get('k39')).toBe('x'.repeat(50))
    expect(reloaded.get('k0')).toBeUndefined()
    expect(cache.get('k0')).toBeUndefined() // 内存里也淘汰了，与重启后一致
  })

  it('单条超限或不能序列化的值：本次运行可读，不落盘、不影响其它条目', () => {
    const dir = tempDir()
    const storage = createPluginStorage({ dir, maxBytes: 512 })
    const cache = storage.forPlugin(A)
    const big = 'y'.repeat(2000)
    const fn = (): number => 1
    cache.set('small', { a: 1 })
    cache.set('big', big)
    cache.set('fn', fn)
    expect(() => cache.set('bigint', 1n)).not.toThrow()
    expect(cache.get('big')).toBe(big)
    expect(cache.get('fn')).toBe(fn)
    const reloaded = createPluginStorage({ dir, maxBytes: 512 }).forPlugin(A)
    expect(reloaded.get('small')).toEqual({ a: 1 })
    expect(reloaded.get('big')).toBeUndefined()
    expect(reloaded.get('bigint')).toBeUndefined()
  })

  it('同一次运行里读回原值（同一引用）', () => {
    const cache = createPluginStorage().forPlugin(A)
    const value = { nested: [1, 2] }
    cache.set('v', value)
    expect(cache.get('v')).toBe(value)
  })
})

describe('插件 $cache：文件安全', () => {
  it('先写临时文件再改名：临时文件写不了时原文件不变，也不抛给插件', () => {
    const dir = tempDir()
    const cache = createPluginStorage({ dir }).forPlugin(A)
    cache.set('k', 'v1')
    mkdirSync(`${fileOf(dir, A)}.${process.pid}.tmp`) // 让写临时文件失败
    expect(() => cache.set('k', 'v2')).not.toThrow()
    expect(cache.get('k')).toBe('v2')
    expect(createPluginStorage({ dir }).forPlugin(A).get('k')).toBe('v1')
  })

  it('文件损坏或形状不对当作空的；__proto__ 当普通键', () => {
    const dir = tempDir()
    writeFileSync(fileOf(dir, A), '{"k": {"v": 1, "at"')
    writeFileSync(fileOf(dir, B), '[1,2,3]')
    const storage = createPluginStorage({ dir })
    expect(storage.forPlugin(A).get('k')).toBeUndefined()
    expect(storage.forPlugin(B).get('0')).toBeUndefined()
    storage.forPlugin(A).set('__proto__', 'p')
    storage.forPlugin(A).set('k', 'v')
    const reloaded = createPluginStorage({ dir }).forPlugin(A)
    expect(reloaded.get('__proto__')).toBe('p')
    expect(reloaded.get('k')).toBe('v')
    expect(JSON.parse(readFileSync(fileOf(dir, A), 'utf8'))).toHaveProperty('k')
  })
})
