/**
 * 引擎入口接线（src/engine/index.ts）：插件 $cache 落在 userData/online/plugin-storage，
 * 引擎进程重启（重新加载入口、同一个 userData）后插件读到上次存的 token，不再注册设备。
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FromUtility, ToUtility } from '../src/shared/utility/protocol'
import { SITES } from '../src/engine/online'

const env = vi.hoisted(() => ({ requests: [] as string[], plugin: '' }))

vi.mock('electron', () => ({
  net: {
    fetch: async (url: string) => {
      env.requests.push(url)
      if (url.endsWith('/register'))
        return new Response(`tok-${env.requests.length}`)
      return new Response(env.plugin)
    },
  },
}))
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}))

env.plugin = `
async function search() {
  let auth = $cache.get('auth')
  if (!auth) {
    const { data } = await $fetch.get('https://site.test/register')
    auth = jsonify({ token: data })
    $cache.set('auth', auth)
  }
  return jsonify({ token: argsify(auth).token })
}`

type Listener = (e: { data: ToUtility }) => void
const realArgv = process.argv
const proc = process as unknown as { parentPort?: unknown }

/** 加载一次引擎入口（= 起一个引擎进程），返回调用 online.vod 的函数。 */
async function bootEngine(
  userData: string
): Promise<(siteName: string) => Promise<unknown>> {
  vi.resetModules()
  let listener: Listener = () => {}
  const pending = new Map<number, (m: FromUtility) => void>()
  proc.parentPort = {
    postMessage: (m: FromUtility) => {
      if (m.kind === 'result') pending.get(m.id)?.(m)
      if (m.kind === 'host')
        listener({
          data: { kind: 'reply', id: m.id, ok: true, value: userData },
        })
    },
    on: (_event: string, fn: Listener) => (listener = fn),
  }
  process.argv = [realArgv[0], 'engine.js', userData]
  await import('../src/engine/index')
  let id = 0
  return siteName =>
    new Promise(resolve => {
      const callId = ++id
      pending.set(callId, m => resolve(m))
      listener({
        data: {
          kind: 'call',
          id: callId,
          method: 'online:vod',
          args: [{ action: 'search', siteName, keyword: 'x' }],
        },
      })
    })
}

afterEach(() => {
  process.argv = realArgv
  delete proc.parentPort
})

describe('引擎入口：插件 $cache 持久化接线', () => {
  it('落盘到 userData/online/plugin-storage，重启后不再注册设备', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'engine-ud-'))
    const site = SITES[0].name
    const first = await (await bootEngine(userData))(site)
    expect(first).toMatchObject({
      ok: true,
      value: { success: true, data: { token: expect.stringMatching(/^tok-/) } },
    })
    const dir = join(userData, 'online', 'plugin-storage')
    expect(existsSync(dir)).toBe(true)
    expect(readdirSync(dir)).toHaveLength(1)

    const registered = env.requests.filter(u => u.endsWith('/register'))
    expect(registered).toHaveLength(1)
    const second = await (await bootEngine(userData))(site)
    expect(second).toMatchObject({
      value: { data: (first as { value: { data: unknown } }).value.data },
    })
    expect(env.requests.filter(u => u.endsWith('/register'))).toHaveLength(1)
  }, 30_000)
})
