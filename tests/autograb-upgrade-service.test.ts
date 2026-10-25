import { describe, expect, it, vi } from 'vitest'

import {
  type GateState,
  createGate,
  emptyGate,
} from '../src/main/autograb/gate'
import {
  type UpgradeDeps,
  type UpgradeService,
  createUpgradeService,
} from '../src/main/autograb/upgrade/service'
import { UPGRADE_INTERVAL_MS } from '../src/main/autograb/upgrade/quality-rules'
import type { LibraryItemNode } from '../src/shared/library/ipc'

const GB = 1024 ** 3
const OLD = '/mnt/115/影视/电影/流浪地球2 (2023)/流浪地球2.2023.720p.mkv'
const NEW = '流浪地球2.2023.2160p.WEB-DL.mkv'

const movieNode = {
  id: 5,
  libraryId: 1,
  type: 'movie',
  title: '流浪地球2',
  year: 2023,
  seasonNumber: null,
  episodeNumber: null,
  files: [{ id: 1, path: OLD, kind: 'video', size: 2 * GB, mtime: 0 }],
  children: [],
} as unknown as LibraryItemNode

interface Harness {
  service: UpgradeService
  deps: UpgradeDeps
  clock: { t: number }
  local: Set<string>
  received: { ids: string[]; cid: string }[]
  removed: string[]
  notified: string[]
  gateState: GateState
}

function setup(
  options: { mountRoot?: string; folderHasOld?: boolean } = {}
): Harness {
  const clock = { t: new Date(2026, 9, 25, 10).getTime() }
  const local = new Set<string>([OLD])
  const received: { ids: string[]; cid: string }[] = []
  const removed: string[] = []
  const notified: string[] = []
  const tree: Record<string, { cid: string; name: string }[]> = {
    '0': [{ cid: '10', name: '影视' }],
    '10': [{ cid: '20', name: '电影' }],
    '20': [{ cid: '30', name: '流浪地球2 (2023)' }],
  }
  const folder30 =
    options.folderHasOld === false ? [] : ['流浪地球2.2023.720p.mkv']
  const gateState = emptyGate(clock.t)
  const gate = createGate(
    gateState,
    {
      now: () => clock.t,
      sleep: async ms => void (clock.t += ms),
      random: () => 0,
    },
    () => {}
  )
  let saved: unknown = null
  const deps: UpgradeDeps = {
    library: {
      listLibraries: async () => [
        {
          id: 1,
          name: '电影',
          root: '/mnt/115/影视/电影',
          kind: 'movie',
          source: 'tmdb',
          createdAt: 0,
          lastScanAt: null,
          automation: {} as never,
          cloud: true,
        },
      ],
      query: async () => ({
        items: [{ id: 5 } as never],
        total: 1,
        offset: 0,
        limit: 500,
      }),
      getItem: async () => movieNode,
    },
    gate: async () => gate,
    pan: {
      loggedIn: () => true,
      pansouReady: () => true,
      search: vi.fn(async () => [
        {
          title: '流浪地球2 4K',
          source: 'x',
          url: 'https://115.com/s/abc?password=1234',
          shareCode: 'abc',
          receiveCode: '1234',
        },
      ]),
      snap: vi.fn(async () => ({
        title: '流浪地球2',
        count: 2,
        files: [
          {
            id: 'f1',
            name: '流浪地球2.2023.720p.WEB-DL.mkv',
            size: 2 * GB,
            isDir: false,
          },
          { id: 'f2', name: NEW, size: 20 * GB, isDir: false },
        ],
      })),
      receive: async (_u, _p, ids, cid) => void received.push({ ids, cid }),
      names: async cid => (cid === '30' ? folder30 : []),
      dirs: async cid => ({
        cid,
        path: [],
        dirs: tree[cid] ?? [],
        truncated: false,
      }),
    },
    mountRoot: () => options.mountRoot ?? '/mnt/115',
    fileExists: async path => local.has(path),
    removeFile: async path => {
      removed.push(path)
      local.delete(path)
    },
    notify: async paths => void notified.push(...paths),
    load: async () => saved,
    save: async state => void (saved = JSON.parse(JSON.stringify(state))),
    now: () => clock.t,
    emit: () => {},
    log: () => {},
  }
  return {
    service: createUpgradeService(deps),
    deps,
    clock,
    local,
    received,
    removed,
    notified,
    gateState,
  }
}

describe('洗版服务', () => {
  it('关着时什么都不做', async () => {
    const { service, deps } = setup()
    await service.tick()
    expect(deps.pan.search).not.toHaveBeenCalled()
  })

  it('清点 → 只列更清楚的候选 → 存进旧文件所在文件夹 → 新文件到本地记为已替换 → 手动删旧文件', async () => {
    const h = setup()
    await h.service.setOptions({ enabled: true })
    await h.service.tick()
    let o = await h.service.overview()
    expect(o.counts.found).toBe(1)
    const entry = o.entries[0]
    expect(entry.resolution).toBe(720)
    expect(entry.candidates.map(c => c.fileName)).toEqual([NEW])

    expect(await h.service.replace(entry.key, 0)).toEqual({ ok: true })
    expect(h.received).toEqual([{ ids: ['f2'], cid: '30' }])
    expect(h.gateState.receives).toBe(1)

    // 旧文件没删时不能删：先要新文件在本地
    expect((await h.service.deleteOld(entry.key)).ok).toBe(false)
    h.local.add(`/mnt/115/影视/电影/流浪地球2 (2023)/${NEW}`)
    await h.service.tick()
    o = await h.service.overview()
    expect(o.entries[0].status).toBe('replaced')
    expect(h.notified).toEqual([`/mnt/115/影视/电影/流浪地球2 (2023)/${NEW}`])
    expect(h.local.has(OLD)).toBe(true)

    expect(await h.service.deleteOld(entry.key)).toEqual({ ok: true })
    expect(h.removed).toEqual([OLD])
    expect((await h.service.overview()).counts.cleaned).toBe(1)
  })

  it('115 文件夹里没有旧文件就不存，要用户选文件夹', async () => {
    const h = setup({ folderHasOld: false })
    await h.service.setOptions({ enabled: true })
    await h.service.tick()
    const key = (await h.service.overview()).entries[0].key
    const result = await h.service.replace(key, 0)
    expect(result).toMatchObject({ ok: false, needFolder: true })
    expect(h.received).toEqual([])
  })

  it('没有更清楚的就一周后再搜', async () => {
    const h = setup()
    vi.mocked(h.deps.pan.snap).mockResolvedValue({
      title: 'x',
      count: 1,
      files: [
        {
          id: 'f1',
          name: '流浪地球2.2023.720p.mkv',
          size: 2 * GB,
          isDir: false,
        },
      ],
    })
    await h.service.setOptions({ enabled: true })
    await h.service.tick()
    const searches = vi.mocked(h.deps.pan.search).mock.calls.length
    await h.service.tick()
    expect(vi.mocked(h.deps.pan.search).mock.calls.length).toBe(searches)
    h.clock.t += UPGRADE_INTERVAL_MS
    await h.service.tick()
    expect(vi.mocked(h.deps.pan.search).mock.calls.length).toBeGreaterThan(
      searches
    )
  })

  it('闸门熔断时不搜（和剧集追更共用）', async () => {
    const h = setup()
    h.gateState.pausedUntil = h.clock.t + 3_600_000
    await h.service.setOptions({ enabled: true })
    await h.service.tick()
    expect(h.deps.pan.search).not.toHaveBeenCalled()
    expect((await h.service.overview()).pauseReason).toContain('闸门')
  })

  it('目标改成 4K 会重新清点', async () => {
    const h = setup()
    movieNode.files[0].path = OLD.replace('720p', '1080p')
    try {
      await h.service.setOptions({ enabled: true })
      await h.service.tick()
      expect(
        (await h.service.overview()).counts.waiting +
          (await h.service.overview()).counts.found
      ).toBe(0)
      await h.service.setOptions({ target: 2160 })
      await h.service.tick()
      expect((await h.service.overview()).counts.found).toBe(1)
    } finally {
      movieNode.files[0].path = OLD
    }
  })
})
