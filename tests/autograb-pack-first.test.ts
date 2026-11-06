/**
 * 追更 · 合集优先（ADR-0050）：缺多集时先找合集，点开后把全部视频认成缺集，只给缺的集带候选。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  MAX_PACK_SHARES,
  type PackDeps,
  findPackCandidates,
  packKey,
  packShares,
} from '../src/main/autograb/pack-finder'
import type {
  NetdiskItem,
  ShareFile,
  ShareSnap,
} from '../src/shared/contract/pan115'
import { episode, setup } from './autograb-harness'
import { emptyState } from '../src/main/autograb/state'

const GB = 1024 ** 3
const file = (id: string, name: string, isDir = false): ShareFile => ({
  id,
  name,
  size: isDir ? 0 : 2 * GB,
  isDir,
})
const share = (
  code: string,
  title: string,
  datetime = '2026-10-01'
): NetdiskItem => ({
  title,
  source: 'x',
  datetime,
  url: `https://115.com/s/${code}?password=1234`,
  shareCode: code,
  receiveCode: '1234',
})

/** 假合集：顶层一个「第 1 季」文件夹，里面 01–05 集，另有花絮 */
function tree(): Record<string, ShareSnap> {
  const eps = [1, 2, 3, 4, 5].map(n =>
    file(`e${n}`, `繁花.S01E0${n}.2160p.WEB-DL.mkv`)
  )
  return {
    '': {
      title: '繁花',
      count: 2,
      files: [file('d1', '繁花 第1季', true), file('x', '花絮.mkv')],
    },
    d1: { title: '繁花', count: 5, files: eps },
  }
}

const deps = (items: NetdiskItem[], snaps = tree()): PackDeps => ({
  search: async () => items,
  snap: async (_item: NetdiskItem, cid: string) =>
    snaps[cid] ?? { title: '', count: 0, files: [] },
  blocked: () => false,
  block: () => {},
  isDead: () => false,
})

describe('合集优先', () => {
  it('全自动连续处理超过三集的合集缺集，不等待下一轮或人工确认', async () => {
    const h = setup([1, 2, 3, 4, 5].map(n => episode(n)))
    h.deps.defaultFolder = () => ({ cid: '88', name: '剧集' })
    h.deps.pan.receive = async (_url, _password, ids, cid) => {
      h.received.push(ids)
      h.files.set(cid, [
        ...(h.files.get(cid) ?? []),
        ...ids.map(id => ({
          id: `9${id}`,
          name: `繁花.S01E0${Number(id) - 100}.2160p.WEB-DL.mkv`,
          isDir: false,
          size: GB,
        })),
      ])
      if (h.received.length === 1) await h.service.setEnabled(false)
    }
    h.deps.pan.search = async () => [share('abc', '繁花 全5集 合集')]
    h.deps.pan.snap = async () => ({
      title: '繁花',
      count: 5,
      files: [1, 2, 3, 4, 5].map(n =>
        file(String(100 + n), `繁花.S01E0${n}.2160p.WEB-DL.mkv`)
      ),
    })
    await h.service.setSeries(7, { mode: 'auto', title: '繁花' })
    await h.service.tick()
    expect(h.received).toHaveLength(1)
    await h.service.setEnabled(true)
    await h.service.tick()
    expect(h.received).toHaveLength(5)
    expect(
      (await h.service.overview()).episodes.every(ep => ep.status === 'saved')
    ).toBe(true)
  })

  it('当天限额耗尽保留候选，次日恢复自动转存', async () => {
    const h = setup([episode(5)])
    const state = emptyState(h.clock.t)
    state.gate.receives = 30
    h.deps.load = async () => state
    h.deps.defaultFolder = () => ({ cid: '88', name: '剧集' })
    await h.service.setSeries(7, { mode: 'auto', title: '繁花' })
    await h.service.tick()
    expect(h.received).toHaveLength(0)
    expect((await h.service.overview()).episodes[0]).toMatchObject({
      status: 'found',
      error: null,
    })
    h.clock.t += 24 * 3_600_000
    await h.service.tick()
    expect(h.received).toHaveLength(1)
    expect((await h.service.overview()).episodes[0].status).toBe('saved')
  })
  it('分享挑选：剧名对得上、像合集、不是别的季，新的在前，最多 3 个', () => {
    const items = [
      share('a', '繁花 全30集 合集', '2026-10-01'),
      share('b', '繁花 S01E05', '2026-10-09'),
      share('c', '庆余年 全46集', '2026-10-09'),
      share('d', '繁花 S02 合集', '2026-10-09'),
      share('e', '繁花 更新至20集', '2026-10-05'),
    ]
    const picked = packShares(items, { seriesTitle: '繁花' }, new Set([1]))
    expect(picked.map(i => i.shareCode)).toEqual(['e', 'a'])
    expect(picked.length).toBeLessThanOrEqual(MAX_PACK_SHARES)
  })

  it('PanSou 常见标题：集数区间（1-18）和没写集号的整部剧也是合集，单集分享不是', () => {
    const items = [
      share('s1', '📺 小城良方 (2026) S01E22 ✨4K WEB-DL', '2026-10-30'),
      share('r1', '🎬 小城良方 (2026) 19-20', '2026-10-29'),
      share('r2', '🎬 小城良方 (2026) 1-18', '2026-10-29'),
      share('r3', '🎬 小城良方 (2026) 1-14', '2026-10-27'),
      share('w', '小城良方', '2026-01-01'),
    ]
    const picked = packShares(
      items,
      { seriesTitle: '小城良方' },
      new Set([1]),
      () => false,
      [1, 2, 3, 4]
    )
    // 1-18 与 1-14 都覆盖 4 个缺集，19-20 一个也不覆盖，被丢掉；整部剧的分享留在后面
    expect(picked.map(i => i.shareCode)).toEqual(['r2', 'r3', 'w'])
  })

  it('点开合集：只给缺的集带候选，花絮和已有的集不认', async () => {
    const found = await findPackCandidates(
      deps([share('a', '繁花 全5集 合集')]),
      { seriesTitle: '繁花' },
      [
        { season: 1, episode: 2 },
        { season: 1, episode: 4 },
        { season: 1, episode: 9 },
      ]
    )
    expect([...found.keys()].sort()).toEqual(['1:2', '1:4'])
    expect(found.get(packKey({ season: 1, episode: 2 }))![0].fileId).toBe('e2')
  })

  it('撤销过的候选不再列出；分享打不开时拉黑并跳过', async () => {
    const base = deps([share('a', '繁花 全5集 合集')])
    const banned = await findPackCandidates(
      base,
      { seriesTitle: '繁花' },
      [{ season: 1, episode: 2 }],
      { banned: () => ['a/e2'] }
    )
    expect(banned.size).toBe(0)
    const blocked: string[] = []
    const dead = await findPackCandidates(
      {
        ...base,
        snap: async () => {
          throw Object.assign(new Error('失效'), { code: 4100010 })
        },
        isDead: () => true,
        block: code => void blocked.push(code),
      },
      { seriesTitle: '繁花' },
      [{ season: 1, episode: 2 }]
    )
    expect(dead.size).toBe(0)
    expect(blocked).toEqual(['a'])
  })
})

describe('追更服务：缺多集时先找合集', () => {
  it('合集快照等待期间可读取真实搜索阶段，完成后返回匹配数量', async () => {
    const h = setup([episode(1), episode(2)])
    let release = (): void => {}
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const started = vi.fn()
    h.deps.pan.search = async () => [share('abc', '繁花 全2集 合集')]
    h.deps.pan.snap = async () => {
      started()
      await pending
      return { title: '繁花', count: 0, files: [] }
    }
    await h.service.setSeries(7, { mode: 'confirm', title: '繁花' })
    try {
      await vi.waitFor(() => expect(started).toHaveBeenCalled())
      expect((await h.service.overview()).packSearch).toEqual([
        { seriesId: 7, status: 'searching', matched: 0, total: 2 },
      ])
    } finally {
      release()
    }
    await h.service.tick()
    expect((await h.service.overview()).packSearch?.[0]).toMatchObject({
      status: 'complete',
      matched: 0,
    })
  })

  it('合集覆盖部分缺集时，先转存已匹配的集，再补搜其余单集', async () => {
    const h = setup([episode(1), episode(2), episode(3)])
    h.deps.defaultFolder = () => ({ cid: '88', name: '剧集' })
    const order: string[] = []
    h.deps.pan.search = async () => [share('abc', '繁花 全3集 合集')]
    h.deps.pan.snap = async () => {
      order.push('snapshot')
      return {
        title: '繁花',
        count: 2,
        files: [
          file('101', '繁花.S01E01.2160p.WEB-DL.mkv'),
          file('102', '繁花.S01E02.2160p.WEB-DL.mkv'),
        ],
      }
    }
    const receive = h.deps.pan.receive
    h.deps.pan.receive = async (...args) => {
      order.push(`save-${args[2][0]}`)
      await receive(...args)
    }
    await h.service.setSeries(7, { mode: 'auto', title: '繁花' })
    await h.service.tick()
    expect(order.filter(x => x === 'snapshot')).toHaveLength(2)
    expect(order.indexOf('save-101')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('save-102')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('save-102')).toBeLessThan(
      order.lastIndexOf('snapshot')
    )
    expect((await h.service.overview()).packSearch).toEqual([
      { seriesId: 7, status: 'complete', matched: 2, total: 3 },
    ])
  })

  it('缺 2 集以上：一次点开合集，两集都带上候选；缺 1 集仍逐集搜', async () => {
    const h = setup([])
    const eps = [1, 2].map(n => ({
      seriesId: 7,
      libraryId: 1,
      seriesTitle: '繁花',
      originalTitle: null,
      season: 1,
      episode: n,
      title: null,
      airDate: '2026-10-20',
      still: null,
      backdrop: null,
      poster: null,
      itemId: null,
      fileId: null,
      filePath: null,
    }))
    h.deps.calendar = async () => ({
      episodes: eps,
      configured: true,
      series: 1,
      failed: 0,
    })
    const snapCalls: string[] = []
    h.deps.pan.search = async () => [share('abc', '繁花 全2集 合集')]
    const snaps = {
      '': {
        title: '繁花',
        count: 2,
        files: [
          file('101', '繁花.S01E01.2160p.WEB-DL.mkv'),
          file('102', '繁花.S01E02.2160p.WEB-DL.mkv'),
        ],
      },
    } as Record<string, ShareSnap>
    h.deps.pan.snap = async (_u, _p, cid) => {
      snapCalls.push(cid)
      return snaps[cid]
    }
    await h.service.setSeries(7, { mode: 'confirm', title: '繁花' })
    await h.service.tick()
    const overview = await h.service.overview()
    const found = overview.episodes.filter(e => e.seriesId === 7)
    expect(found.map(e => e.episode).sort()).toEqual([1, 2])
    expect(found.every(e => e.candidates.length > 0)).toBe(true)
    // 两集共用一次点开合集（顶层一次快照），不是每集各搜一次
    expect(snapCalls.filter(c => c === '').length).toBe(1)
  })
})
