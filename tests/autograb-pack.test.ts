/**
 * 追更 · 整季包与偏好打分：合集分享多翻页、多下几层、按集数区间挑文件夹，挑出单集文件；
 * 偏好（首选分辨率、偏好词、排除词、体积）接进认文件规则。
 */
import { describe, expect, it } from 'vitest'

import { FIND_MAX_SNAPS, createFinder } from '../src/main/autograb/finder'
import { matchFile } from '../src/main/autograb/match-rules'
import {
  episodeRange,
  folderVerdict,
  looksLikePack,
} from '../src/main/autograb/pack-rules'
import { candidateKey } from '../src/main/autograb/state'
import {
  DEFAULT_PREFS,
  mergePrefs,
  prefsOverrideOf,
} from '../src/shared/contract/autograb-prefs'
import type {
  NetdiskItem,
  ShareFile,
  ShareSnap,
} from '../src/shared/contract/pan115'

const GB = 1024 ** 3
const target = { seriesTitle: '繁花', season: 1, episode: 15 }
const file = (id: string, name: string, size = 2 * GB): ShareFile => ({
  id,
  name,
  size,
  isDir: false,
})
const dir = (id: string, name: string): ShareFile => ({
  id,
  name,
  size: 0,
  isDir: true,
})
const share = (title: string): NetdiskItem => ({
  title,
  source: 'x',
  url: 'https://115.com/s/pack?password=1234',
  shareCode: 'pack',
  receiveCode: '1234',
})

/** 假分享：目录 cid → 全部条目，按 offset 每页 100 条 */
function finderOver(
  tree: Record<string, ShareFile[]>,
  title = '繁花'
): { finder: ReturnType<typeof createFinder>; calls: string[] } {
  const calls: string[] = []
  const finder = createFinder({
    search: async () => [share(title)],
    snap: async (_item, cid, offset): Promise<ShareSnap> => {
      calls.push(`${cid}@${offset}`)
      const all = tree[cid] ?? []
      return {
        title,
        count: all.length,
        files: all.slice(offset, offset + 100),
      }
    },
    blocked: () => false,
    block: () => {},
    now: () => 0,
  })
  return { finder, calls }
}

describe('追更 · 整季包规则', () => {
  it('认出合集名字', () => {
    expect(looksLikePack('繁花 全30集 4K')).toBe(true)
    expect(looksLikePack('Severance Season 2 Complete')).toBe(true)
    expect(looksLikePack('繁花 S01 2160p')).toBe(true)
    expect(looksLikePack('繁花 01-10集')).toBe(true)
    expect(looksLikePack('繁花 S01E05 2160p')).toBe(false)
    expect(looksLikePack('繁花 第5集')).toBe(false)
  })

  it('集数区间与文件夹判断', () => {
    expect(episodeRange('EP11-20')).toEqual([11, 20])
    expect(episodeRange('第21~30集')).toEqual([21, 30])
    expect(episodeRange('2160p')).toBeNull()
    expect(folderVerdict('11-20', target)).toBe('open')
    expect(folderVerdict('01-10', target)).toBe('skip')
    expect(folderVerdict('第2季', target)).toBe('skip')
    expect(folderVerdict('Season 1', target)).toBe('open')
    expect(folderVerdict('花絮', target)).toBe('skip')
    expect(folderVerdict('4K', target)).toBe('maybe')
  })
})

describe('追更 · 整季包展开', () => {
  it('第二页里的那一集：合集按 offset 翻页找到', async () => {
    const files = Array.from({ length: 30 }, (_, i) =>
      file(`f${i + 1}`, `繁花.S01E${String(i + 1).padStart(2, '0')}.mkv`)
    )
    const padding = Array.from({ length: 100 }, (_, i) =>
      dir(`x${i}`, `其他${i}`)
    )
    const { finder, calls } = finderOver({ '': [...padding, ...files] })
    const result = await finder.find(target)
    expect(result.candidates.map(c => c.fileId)).toEqual(['f15'])
    expect(calls).toEqual(['@0', '@100'])
  })

  it('剧名 / 集数区间两层文件夹：只点包含这一集的那个', async () => {
    const { finder, calls } = finderOver(
      {
        '': [dir('d1', '繁花 2023')],
        d1: [dir('a', '01-10'), dir('b', '11-20'), dir('c', '21-30')],
        b: [file('e14', '繁花.E14.mkv'), file('e15', '繁花.E15.mkv')],
      },
      '繁花 全30集'
    )
    const result = await finder.find(target)
    expect(result.candidates.map(c => c.fileId)).toEqual(['e15'])
    expect(calls).toEqual(['@0', 'd1@0', 'b@0'])
  })

  it('合并成一个文件的多集仍然拒绝；撤销过的候选不再列出', async () => {
    const tree = {
      '': [file('m', '繁花.E15-E16.mkv', 4 * GB), file('s', '繁花.E15.mkv')],
    }
    const { finder } = finderOver(tree, '繁花 全30集')
    expect((await finder.find(target)).candidates.map(c => c.fileId)).toEqual([
      's',
    ])
    const banned = [candidateKey('pack', 's')]
    expect((await finder.find(target, { banned })).candidates).toEqual([])
  })
})

describe('追更 · 快照上限', () => {
  it('几个大合集都没有这一集：一次查找合计不超过上限', async () => {
    let calls = 0
    const deep = Array.from({ length: 3 }, (_, i) => dir(`d${i}`, `第1季 ${i}`))
    const finder = createFinder({
      search: async () =>
        ['a', 'b', 'c', 'd'].map(code => ({
          ...share('繁花 全30集'),
          shareCode: code,
          url: `https://115.com/s/${code}`,
        })),
      snap: async () => {
        calls++
        return { title: '繁花', count: 3, files: deep }
      },
      blocked: () => false,
      block: () => {},
      now: () => 0,
    })
    const result = await finder.find(target)
    expect(result.candidates).toEqual([])
    expect(calls).toBeLessThanOrEqual(FIND_MAX_SNAPS)
  })
})

describe('追更 · 偏好与版本分', () => {
  const ep5 = { seriesTitle: '繁花', season: 1, episode: 5 }
  const ctx = { shareTitle: '繁花', folder: '' }
  const score = (
    name: string,
    prefs = DEFAULT_PREFS,
    size = 2 * GB
  ): number => {
    const m = matchFile({ name, size, isDir: false }, ep5, ctx, prefs)
    return m.ok ? m.quality : -1
  }

  it('首选分辨率命中的高于其它分辨率', () => {
    const p = { ...DEFAULT_PREFS, resolution: '1080p' as const }
    expect(score('繁花.E05.1080p.mkv', p)).toBeGreaterThan(
      score('繁花.E05.2160p.mkv', p)
    )
    expect(score('繁花.E05.2160p.mkv')).toBeGreaterThan(
      score('繁花.E05.1080p.mkv')
    )
  })

  it('偏好词加分，排除词拒绝，体积上下限替换默认', () => {
    const p = {
      ...DEFAULT_PREFS,
      preferWords: ['ADWeb'],
      excludeWords: ['HDR'],
      maxMb: 1024,
    }
    expect(score('繁花.E05.ADWeb.mkv', p, 0.5 * GB)).toBeGreaterThan(
      score('繁花.E05.mkv', p, 0.5 * GB)
    )
    expect(score('繁花.E05.HDR.mkv', p, 0.5 * GB)).toBe(-1)
    expect(score('繁花.E05.mkv', p, 2 * GB)).toBe(-1)
  })

  it('合并：排除词叠加，其余覆盖；坏输入丢掉', () => {
    const global = { ...DEFAULT_PREFS, excludeWords: ['枪版'], minMb: 100 }
    expect(
      mergePrefs(global, { excludeWords: ['HDR'], resolution: '720p' })
    ).toEqual({
      ...global,
      resolution: '720p',
      excludeWords: ['枪版', 'HDR'],
    })
    expect(
      prefsOverrideOf({ minMb: 500, maxMb: 200, resolution: 'x' })
    ).toEqual({
      maxMb: 200,
    })
    expect(prefsOverrideOf({ preferWords: [' a ', 'A', '', 1] })).toEqual({
      preferWords: ['a'],
    })
  })
})
