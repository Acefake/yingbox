import { describe, expect, it, vi } from 'vitest'

import type { AutograbDeps } from '../src/main/autograb/deps'
import { createAutograbService } from '../src/main/autograb/service'
import { NOTIFY_AFTER_MS } from '../src/main/autograb/saver'
import {
  type DiscoverDeps,
  createDiscoverService,
} from '../src/main/discover/service'
import { Pan115Error } from '../src/main/pan115/errors'
import type { DiscoverTarget } from '../src/shared/contract/discover'

const GB = 1024 ** 3
const TARGET: DiscoverTarget = {
  kind: 'movie',
  title: '星际穿越',
  originalTitle: 'Interstellar',
  year: 2014,
}

/** 真的追更服务（只用它的闸门），时钟可控、sleep 直接推进时钟 */
function autograbFor(clock: {
  t: number
}): ReturnType<typeof createAutograbService> {
  const deps = {
    calendar: async () => ({
      episodes: [],
      configured: true,
      series: 0,
      failed: 0,
    }),
    notify: async () => {},
    pan: {
      loggedIn: () => true,
      pansouReady: () => true,
    } as AutograbDeps['pan'],
    defaultFolder: () => ({ cid: '0', name: '' }),
    load: async () => null,
    save: async () => {},
    now: () => clock.t,
    sleep: async (ms: number) => void (clock.t += ms),
    emit: () => {},
    log: () => {},
  } satisfies AutograbDeps
  return createAutograbService(deps)
}

interface Harness {
  service: ReturnType<typeof createDiscoverService>
  autograb: ReturnType<typeof createAutograbService>
  pan: DiscoverDeps['pan']
  received: Array<{ ids: string[]; cid: string }>
  notified: string[]
  timers: Array<() => void>
  folders: Map<string, string[]>
  clock: { t: number }
  /** 转存目标（测试里可改） */
  dest: { cid: string; name: string }
}

function setup(over: Partial<DiscoverDeps['pan']> = {}): Harness {
  const clock = { t: Date.parse('2026-10-25T12:00:00+08:00') }
  const autograb = autograbFor(clock)
  const received: Array<{ ids: string[]; cid: string }> = []
  const notified: string[] = []
  const timers: Array<() => void> = []
  const folders = new Map<string, string[]>()
  const dest = { cid: '42', name: '助手' }
  const pan: DiscoverDeps['pan'] = {
    loggedIn: async () => true,
    pansouReady: () => true,
    search: vi.fn(async () => [
      {
        title: '星际穿越 2014 4K 中字',
        source: 'tg:x',
        url: 'https://115.com/s/abc?password=1234',
        shareCode: 'abc',
        receiveCode: '1234',
      },
    ]),
    snap: vi.fn(async () => ({
      title: '星际穿越',
      count: 3,
      files: [
        {
          id: 'f1',
          name: '星际穿越.2014.2160p.BluRay.mkv',
          size: 20 * GB,
          isDir: false,
        },
        {
          id: 'f2',
          name: '星际穿越.2014.1080p.WEB-DL.mkv',
          size: 4 * GB,
          isDir: false,
        },
        {
          id: 'f3',
          name: '星际穿越.2014.预告.mp4',
          size: 1 * GB,
          isDir: false,
        },
      ],
    })),
    receive: async (_url, _pwd, ids, cid) => {
      received.push({ ids, cid })
    },
    names: async cid => folders.get(cid) ?? [],
    dirPath: async () => ['电影', '助手'],
    ...over,
  }
  const service = createDiscoverService({
    pan,
    guard: () => autograb.guard(),
    folder: () => ({ ...dest }),
    notify: async changes => void notified.push(...changes.map(c => c.path)),
    now: () => clock.t,
    later: (run, ms) => {
      expect(ms).toBe(NOTIFY_AFTER_MS)
      timers.push(run)
    },
    log: () => {},
  })
  return {
    service,
    autograb,
    pan,
    received,
    notified,
    timers,
    folders,
    clock,
    dest,
  }
}

describe('库外发现服务', () => {
  it('搜到前 3 个候选（不含分享链接），快照经追更的闸门计数', async () => {
    const { service, autograb } = setup()
    const result = await service.find(TARGET)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidates.map(c => c.fileName)).toEqual([
      '星际穿越.2014.2160p.BluRay.mkv',
      '星际穿越.2014.1080p.WEB-DL.mkv',
    ])
    expect(Object.keys(result.candidates[0])).not.toContain('shareUrl')
    const overview = await autograb.overview()
    expect(overview.today.snaps).toBe(1)
  })

  it('转存：只存选中的那个 file_id 到助手目标文件夹，10 分钟后按 115 路径通知媒体库', async () => {
    const { service, received, notified, timers } = setup()
    const found = await service.find(TARGET)
    if (!found.ok) throw new Error('应找到候选')
    const saved = await service.save(found.searchId, 1)
    expect(saved).toEqual({
      ok: true,
      fileName: '星际穿越.2014.1080p.WEB-DL.mkv',
      folder: '助手',
    })
    expect(received).toEqual([{ ids: ['f2'], cid: '42' }])
    // 重复点转存不重复存
    await service.save(found.searchId, 1)
    expect(received).toHaveLength(1)
    expect(timers).toHaveLength(1)
    timers[0]()
    await vi.waitFor(() =>
      expect(notified).toEqual(['/电影/助手/星际穿越.2014.1080p.WEB-DL.mkv'])
    )
  })

  it('目标文件夹里同名文件已在：不再转存，算成功', async () => {
    const { service, received, folders } = setup()
    folders.set('42', ['星际穿越.2014.2160p.BluRay.mkv'])
    const found = await service.find(TARGET)
    if (!found.ok) throw new Error('应找到候选')
    expect((await service.save(found.searchId, 0)).ok).toBe(true)
    expect(received).toEqual([])
  })

  it('115 风控：闸门暂停后（追更与库外发现共用）不再发请求', async () => {
    const { service, autograb, pan } = setup({
      snap: vi.fn(async () => {
        throw new Pan115Error('操作太频繁，请稍后再试', 911)
      }),
    })
    const first = await service.find(TARGET)
    expect(first.ok).toBe(false)
    expect((await autograb.overview()).pausedUntil).not.toBeNull()
    const second = await service.find(TARGET)
    expect(second).toMatchObject({ ok: false })
    expect(pan.snap).toHaveBeenCalledTimes(1)
  })

  it('分享失效：拉黑进追更的同一张表，下次不再看', async () => {
    const { service, autograb, pan } = setup({
      snap: vi.fn(async () => {
        throw new Pan115Error('分享已取消', 4100010)
      }),
    })
    const result = await service.find(TARGET)
    expect(result).toMatchObject({ ok: true, candidates: [] })
    expect((await autograb.guard()).blocked('abc')).toBe(true)
    await service.find(TARGET)
    expect(pan.snap).toHaveBeenCalledTimes(1)
  })

  it('前提缺失：PanSou 没填 / 115 没登录时提示去设置，不发请求', async () => {
    const noPansou = setup({ pansouReady: () => false })
    expect(await noPansou.service.find(TARGET)).toMatchObject({
      ok: false,
      setup: 'pansou',
    })
    expect(noPansou.pan.search).not.toHaveBeenCalled()
    const noLogin = setup({ loggedIn: async () => false })
    expect(await noLogin.service.find(TARGET)).toMatchObject({
      ok: false,
      setup: 'login',
    })
    expect(await noLogin.service.status()).toMatchObject({
      loggedIn: false,
      pansou: true,
      paused: null,
      folder: '助手',
    })
  })

  it('候选过期或不存在：要求重新搜索', async () => {
    const { service, clock } = setup()
    expect(await service.save('d99', 0)).toMatchObject({ ok: false })
    const found = await service.find(TARGET)
    if (!found.ok) throw new Error('应找到候选')
    clock.t += 2 * 3_600_000
    expect(await service.save(found.searchId, 0)).toEqual({
      ok: false,
      error: '候选已过期，请重新搜索',
    })
  })

  it('换了目标文件夹：同一个候选会重新存到新文件夹', async () => {
    const { service, received, dest } = setup()
    const found = await service.find(TARGET)
    if (!found.ok) throw new Error('应找到候选')
    await service.save(found.searchId, 0)
    dest.cid = '77'
    dest.name = '新电影'
    expect(await service.save(found.searchId, 0)).toMatchObject({
      ok: true,
      folder: '新电影',
    })
    expect(received).toEqual([
      { ids: ['f1'], cid: '42' },
      { ids: ['f1'], cid: '77' },
    ])
  })

  it('连点转存：并发的点击共用一次转存，115 只收到一次', async () => {
    const { service, received } = setup()
    const found = await service.find(TARGET)
    if (!found.ok) throw new Error('应找到候选')
    const [a, b] = await Promise.all([
      service.save(found.searchId, 0),
      service.save(found.searchId, 0),
    ])
    expect(a).toEqual(b)
    expect(a.ok).toBe(true)
    expect(received).toHaveLength(1)
  })

  it('status 出错：回结构化结果（按没登录引导），不抛给 IPC', async () => {
    const { service } = setup({
      loggedIn: async () => {
        throw new Error('读取账号失败')
      },
    })
    expect(await service.status()).toEqual({
      loggedIn: false,
      pansou: true,
      paused: null,
      folder: '助手',
    })
  })
})
