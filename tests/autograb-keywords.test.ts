/**
 * 追更 · 搜索词与分享标题：只搜剧名 / 原名；看快照之前按分享标题丢掉明确是别的集 / 别的季 / 别的剧的分享。
 */
import { describe, expect, it } from 'vitest'

import {
  createFinder,
  keywordsFor,
  rankShares,
} from '../src/main/autograb/finder'
import { matchFile } from '../src/main/autograb/match-rules'
import {
  episodeHintOf,
  otherSeries,
  shareHint,
} from '../src/main/autograb/share-title-rules'
import type { NetdiskItem, ShareSnap } from '../src/shared/contract/pan115'

const GB = 1024 ** 3
const target = { seriesTitle: '嫁金钗', season: 1, episode: 20 }

const share = (code: string, title: string, datetime = ''): NetdiskItem => ({
  title,
  source: 'x',
  url: `https://115.com/s/${code}?password=1234`,
  shareCode: code,
  receiveCode: '1234',
  datetime,
})

describe('追更 · 搜索词', () => {
  it('只搜剧名，不再带集号', () => {
    expect(keywordsFor(target)).toEqual(['嫁金钗'])
  })

  it('原名与剧名不同时加原名，相同或为空时不加', () => {
    expect(
      keywordsFor({
        ...target,
        seriesTitle: 'Severance',
        originalTitle: '人生切割术',
      })
    ).toEqual(['Severance', '人生切割术'])
    expect(keywordsFor({ ...target, originalTitle: ' 嫁金钗 ' })).toEqual([
      '嫁金钗',
    ])
    expect(keywordsFor({ ...target, originalTitle: '' })).toEqual(['嫁金钗'])
  })
})

describe('追更 · 分享标题与这一集', () => {
  const hint = (title: string, t = target): string => episodeHintOf(title, t)

  it('正好这一集', () => {
    expect(hint('嫁金钗 (2026) S01E20 2160p WEB-DL')).toBe('exact')
    expect(hint('嫁金钗 第20集 4K')).toBe('exact')
    expect(hint('嫁金钗 第二十集')).toBe('exact')
    expect(hint('嫁金钗 EP20 中字')).toBe('exact')
    expect(hint('嫁金钗 更新至20集')).toBe('exact')
  })

  it('包含这一集', () => {
    expect(hint('嫁金钗 更新至24集')).toBe('covers')
    expect(hint('嫁金钗 更新至S01E22')).toBe('covers')
    expect(hint('嫁金钗 全30集 4K')).toBe('covers')
    expect(hint('嫁金钗 01-24集')).toBe('covers')
    expect(hint('嫁金钗 S01E01-E24')).toBe('covers')
    expect(hint('嫁金钗 第1集-第24集')).toBe('covers')
    expect(hint('嫁金钗 完结 合集')).toBe('covers')
    expect(hint('嫁金钗 S01-S02 全集')).toBe('covers')
  })

  it('没写集号', () => {
    expect(hint('嫁金钗 (2026) 2160p H265 中字')).toBe('unknown')
    expect(hint('嫁金钗 第一季 1080p')).toBe('unknown')
    expect(hint('')).toBe('unknown')
  })

  it('明确是别的集 / 别的季', () => {
    expect(hint('嫁金钗 S01E19 4K')).toBe('other')
    expect(hint('嫁金钗 第19集')).toBe('other')
    expect(hint('嫁金钗 更新至18集')).toBe('other')
    expect(hint('嫁金钗 全16集')).toBe('other')
    expect(hint('嫁金钗 01-10集')).toBe('other')
    expect(hint('嫁金钗 S02E20')).toBe('other')
    expect(hint('嫁金钗 第二季 第20集')).toBe('other')
    expect(hint('嫁金钗 S02-S03 合集')).toBe('other')
  })

  it('1080p、年份、H265 不当成集号', () => {
    expect(hint('嫁金钗 2026 1080p H265 AAC')).toBe('unknown')
  })

  it('别的剧：标题按单集解析出别的剧名才算，认不出剧名的不算', () => {
    expect(otherSeries('庆余年 S02E20 4K', target)).toBe(true)
    expect(otherSeries('嫁金钗 S01E20', target)).toBe(false)
    expect(otherSeries('4K 电视剧合集', target)).toBe(false)
    expect(otherSeries('2160p 中字 更新中', target)).toBe(false)
    expect(
      otherSeries('人生切割术 S01E20', {
        ...target,
        seriesTitle: 'Severance',
        originalTitle: '人生切割术',
      })
    ).toBe(false)
    expect(shareHint('庆余年 S02E20 4K', target)).toBe('other')
  })
})

describe('追更 · 分享排序', () => {
  it('丢掉别的集，按 正好这一集 → 包含 → 没写集号，同档新的在前', () => {
    const items = [
      share('a', '嫁金钗 1080p', '2026-10-27'),
      share('b', '嫁金钗 S01E19', '2026-10-27'),
      share('c', '嫁金钗 更新至24集', '2026-10-20'),
      share('d', '嫁金钗 S01E20', '2026-10-21'),
      share('e', '嫁金钗 S01E20 4K', '2026-10-26'),
      share('f', '庆余年 S02E20', '2026-10-27'),
    ]
    expect(rankShares(items, target).map(i => i.shareCode)).toEqual([
      'e',
      'd',
      'c',
      'a',
    ])
  })
})

describe('追更 · 查找器', () => {
  function finderOver(items: NetdiskItem[]): {
    finder: ReturnType<typeof createFinder>
    searched: string[]
    snapped: string[]
  } {
    const searched: string[] = []
    const snapped: string[] = []
    const finder = createFinder({
      search: async keyword => {
        searched.push(keyword)
        return items
      },
      snap: async (item): Promise<ShareSnap> => {
        snapped.push(item.shareCode)
        return {
          title: item.title,
          count: 1,
          files: [
            {
              id: `${item.shareCode}1`,
              name: '嫁金钗.S01E20.2160p.WEB-DL.mkv',
              size: 2 * GB,
              isDir: false,
            },
          ],
        }
      },
      blocked: () => false,
      block: () => {},
      now: () => 0,
    })
    return { finder, searched, snapped }
  }

  it('明确是别的集的分享不看快照', async () => {
    const { finder, searched, snapped } = finderOver([
      share('x', '嫁金钗 S01E18'),
      share('y', '嫁金钗 S01E19'),
      share('z', '嫁金钗 S01E20'),
    ])
    const result = await finder.find(target)
    expect(searched).toEqual(['嫁金钗'])
    expect(snapped).toEqual(['z'])
    expect(result.candidates.map(c => c.fileId)).toEqual(['z1'])
  })

  it('搜到的分享都不是这一集：一次快照都不花，给出原因', async () => {
    const { finder, snapped } = finderOver([
      share('x', '嫁金钗 S01E18'),
      share('y', '嫁金钗 更新至19集'),
    ])
    const result = await finder.find(target)
    expect(snapped).toEqual([])
    expect(result).toEqual({
      candidates: [],
      note: '搜到 2 个分享，标题都不是这一集',
    })
  })

  it('剧名不够时再搜原名', async () => {
    const { finder, searched } = finderOver([share('z', '嫁金钗 S01E20')])
    await finder.find({ ...target, originalTitle: 'Jia Jin Chai' })
    expect(searched).toEqual(['嫁金钗', 'Jia Jin Chai'])
  })
})

describe('追更 · 原名认文件', () => {
  it('文件名只有原名时也认', () => {
    const file = {
      name: '人生切割术.S01E20.1080p.mkv',
      size: 2 * GB,
      isDir: false,
    }
    const ctx = { shareTitle: '人生切割术 S01E20', folder: '' }
    expect(
      matchFile(file, { ...target, seriesTitle: 'Severance' }, ctx).ok
    ).toBe(false)
    const match = matchFile(
      file,
      { ...target, seriesTitle: 'Severance', originalTitle: '人生切割术' },
      ctx
    )
    expect(match.ok && match.reasons).toContain('文件名含剧名')
  })
})
