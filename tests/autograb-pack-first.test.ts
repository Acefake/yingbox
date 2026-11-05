/**
 * 追更 · 合集优先（ADR-0050）：缺多集时先找合集，点开后把全部视频认成缺集，只给缺的集带候选。
 */
import { describe, expect, it } from 'vitest'

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
import { setup } from './autograb-harness'

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
