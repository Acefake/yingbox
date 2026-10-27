/**
 * 观看进度同步（桌面端 ↔ 片库服务）：先拉后推、同时间戳以服务端为准、游标与时钟差、失败状态、
 * 服务端那一端的 HTTP（Bearer、不跟重定向、返回体校验），以及设置页的状态文案。
 */
import { describe, expect, it, vi } from 'vitest'

import type {
  ProgressImportResult,
  ProgressSyncEntry,
} from '../src/shared/library/ipc'
import {
  createRemotePeer,
  parseServerUrl,
} from '../src/main/library/progress-sync/remote-peer'
import {
  type ProgressPeer,
  SKEW_MS,
  type SyncCursor,
  createProgressSyncer,
} from '../src/main/library/progress-sync/syncer'
import { syncStatusText } from '../src/renderer/src/features/library/settings/progress-sync-rules'
import { PROGRESS_SYNC_TOKEN_ERROR } from '../src/shared/contract/progress-sync'

const entry = (key: string, updatedAt: number): ProgressSyncEntry => ({
  key,
  position: 10,
  duration: 100,
  watched: false,
  updatedAt,
})

/** 记下调用顺序的内存端。 */
function peer(
  name: string,
  exported: ProgressSyncEntry[],
  log: string[]
): {
  p: ProgressPeer
  imported: Array<{ entries: ProgressSyncEntry[]; prefer: boolean }>
} {
  const imported: Array<{ entries: ProgressSyncEntry[]; prefer: boolean }> = []
  const p: ProgressPeer = {
    export: vi.fn(async (since: number) => {
      log.push(`${name}.export(${since})`)
      return exported
    }),
    import: vi.fn(async (entries, prefer): Promise<ProgressImportResult> => {
      log.push(`${name}.import`)
      imported.push({ entries, prefer })
      return { applied: entries.length, unmatched: 0, itemIds: [1] }
    }),
  }
  return { p, imported }
}

describe('同步器', () => {
  it('先拉后推：拉下来的以服务端为准，推上去的服务端保留自己的；记游标', async () => {
    const log: string[] = []
    const local = peer('local', [entry('movie:1', 5)], log)
    const remote = peer('remote', [entry('tv:2:1:1', 9)], log)
    let cursor: SyncCursor | null = null
    const applied = vi.fn()
    const syncer = createProgressSyncer({
      local: local.p,
      remote: () => ({ server: 'http://nas', peer: remote.p }),
      readCursor: () => cursor,
      writeCursor: c => (cursor = c),
      now: () => 1_000_000,
      onApplied: applied,
    })
    const status = await syncer.sync()
    expect(log).toEqual([
      'remote.export(0)',
      'local.import',
      'local.export(0)',
      'remote.import',
    ])
    expect(local.imported[0].prefer).toBe(true)
    expect(remote.imported[0].prefer).toBe(false)
    expect(applied).toHaveBeenCalledWith([1])
    expect(cursor).toEqual({ server: 'http://nas', lastSync: 1_000_000 })
    expect(status).toMatchObject({
      configured: true,
      syncing: false,
      lastSyncAt: 1_000_000,
      pulled: 1,
      pushed: 1,
      error: null,
    })
  })

  it('游标往回让 SKEW_MS；换了服务端地址从 0 开始', async () => {
    const log: string[] = []
    const local = peer('local', [], log)
    const remote = peer('remote', [], log)
    let server = 'http://nas'
    const syncer = createProgressSyncer({
      local: local.p,
      remote: () => ({ server, peer: remote.p }),
      readCursor: () => ({ server: 'http://nas', lastSync: SKEW_MS + 500 }),
      writeCursor: () => {},
    })
    await syncer.sync()
    expect(log[0]).toBe('remote.export(500)')
    server = 'http://other'
    log.length = 0
    await syncer.sync()
    expect(log[0]).toBe('remote.export(0)')
  })

  it('没配置不同步；出错时记原因、不写游标；同时触发只跑一轮', async () => {
    const off = createProgressSyncer({
      local: peer('l', [], []).p,
      remote: () => null,
      readCursor: () => null,
      writeCursor: () => {},
    })
    expect(await off.sync()).toMatchObject({ configured: false })

    const writeCursor = vi.fn()
    const failing: ProgressPeer = {
      export: vi.fn(async () => {
        throw new Error('连不上片库服务：ECONNREFUSED')
      }),
      import: vi.fn(),
    }
    const syncer = createProgressSyncer({
      local: peer('l', [], []).p,
      remote: () => ({ server: 'http://nas', peer: failing }),
      readCursor: () => null,
      writeCursor,
    })
    const [a, b] = await Promise.all([syncer.sync(), syncer.sync()])
    expect(a).toBe(b)
    expect(failing.export).toHaveBeenCalledTimes(1)
    expect(a.error).toContain('ECONNREFUSED')
    expect(writeCursor).not.toHaveBeenCalled()
  })
})

describe('服务端那一端', () => {
  it('地址只认 http(s)、不带账号密码', () => {
    expect(parseServerUrl(' http://192.168.1.10:31480/ ')).toBe(
      'http://192.168.1.10:31480'
    )
    expect(parseServerUrl('https://nas.local/yb/')).toBe('https://nas.local/yb')
    expect(parseServerUrl('ftp://nas')).toBeNull()
    expect(parseServerUrl('http://u:p@nas')).toBeNull()
    expect(parseServerUrl('')).toBeNull()
  })

  it('POST rpc 带 Bearer、不跟重定向；坏条目丢掉；401 报需要访问令牌', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const body = JSON.parse(String(init.body)) as { method: string }
      const result =
        body.method === 'progress.export'
          ? [entry('movie:1', 1), { key: 'bad' }]
          : { applied: 2, unmatched: 1, itemIds: [9] }
      return new Response(JSON.stringify({ ok: true, result }))
    })
    const remote = createRemotePeer({
      server: 'http://nas:31480',
      token: 't'.repeat(24),
      fetch,
    })
    expect(await remote.export(5)).toEqual([entry('movie:1', 1)])
    expect(await remote.import([entry('movie:1', 1)], false)).toEqual({
      applied: 2,
      unmatched: 1,
      itemIds: [],
    })
    expect(calls[0].url).toBe('http://nas:31480/api/library/rpc')
    expect(calls[0].init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(
      (calls[0].init.headers as Record<string, string>).authorization
    ).toBe(`Bearer ${'t'.repeat(24)}`)

    const denied = createRemotePeer({
      server: 'http://nas',
      token: '',
      fetch: async () => new Response('', { status: 401 }),
    })
    await expect(denied.export(0)).rejects.toThrow(PROGRESS_SYNC_TOKEN_ERROR)
    // 服务默认不鉴权：没填令牌时不带 Authorization 头
    const open = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ ok: true, result: [] }))
    )
    await createRemotePeer({
      server: 'http://nas',
      token: '',
      fetch: open,
    }).export(0)
    expect(
      (open.mock.calls[0][1].headers as Record<string, string>).authorization
    ).toBeUndefined()
    const failed = createRemotePeer({
      server: 'http://nas',
      token: '',
      fetch: async () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: 'x', message: '坏了' } })
        ),
    })
    await expect(failed.export(0)).rejects.toThrow('坏了')
  })
})

describe('设置页状态文案', () => {
  const base = {
    configured: true,
    syncing: false,
    lastSyncAt: null,
    error: null,
    pulled: 0,
    pushed: 0,
  }
  it('同步中 / 失败 / 没同步过 / 上次同步', () => {
    expect(syncStatusText({ ...base, syncing: true }, 0)).toBe('同步中…')
    expect(syncStatusText({ ...base, error: '令牌不对' }, 0)).toBe(
      '同步失败：令牌不对'
    )
    expect(syncStatusText(base, 0)).toBe('还没同步过')
    expect(
      syncStatusText(
        { ...base, lastSyncAt: 0, pulled: 2, pushed: 1 },
        5 * 60_000
      )
    ).toBe('上次同步 5 分钟前，拉下 2 条、推上 1 条')
    expect(syncStatusText({ ...base, lastSyncAt: 0 }, 1000)).toBe(
      '上次同步 刚刚，两边一致'
    )
  })
})
