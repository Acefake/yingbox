/**
 * 网盘页按集搜索：只用剧名查 PanSou、Hero 只在剧集里匹配、结果按这一集分档 + 其他集折叠、
 * 最佳版本只在写明这一集的结果里挑；以及页面 / 预览 / 工具条的接线（源码级断言）。
 * test-affected: repo-wide
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useBestRelease } from '../../src/renderer/src/features/netdisk/composables/use-best-release'
import { useEpisodeRows } from '../../src/renderer/src/features/netdisk/composables/use-episode-rows'
import { useHeroMatch } from '../../src/renderer/src/features/netdisk/composables/use-hero-match'
import { useNetdiskSearch } from '../../src/renderer/src/features/netdisk/composables/use-netdisk-search'
import type { ReleaseSort } from '../../src/renderer/src/features/netdisk/utils/release-quality'
import type { MagnetItem, NetdiskItem } from '../../src/shared/contract/pan115'
import {
  type SearchIntent,
  parseSearchIntent,
} from '../../src/shared/netdisk/search-intent'

const share = (title: string): NetdiskItem => ({
  title,
  source: 'tg:x',
  url: `https://115.com/s/${encodeURIComponent(title)}`,
  shareCode: title,
  receiveCode: '',
})

afterEach(() => void vi.useRealTimers())

describe('useNetdiskSearch · 集号', () => {
  it('只用剧名查 PanSou，意图留给排序', async () => {
    const search = vi.fn().mockResolvedValue({
      ok: true,
      items: [],
      magnets: [],
      notes: [],
    })
    const s = useNetdiskSearch(() => ({ search }))
    s.keyword.value = '嫁金钗 S01E20'
    await s.search()
    expect(search).toHaveBeenCalledWith('嫁金钗')
    expect(s.intent.value).toMatchObject({ kind: 'tv', season: 1, episode: 20 })
    s.reset()
    expect(s.intent.value).toBeNull()
  })
})

describe('useHeroMatch · 集号', () => {
  it('带集号时用剧名查 /search/tv', async () => {
    vi.useFakeTimers()
    const tmdb = vi.fn(async (path: string, _query?: object) =>
      path === '/search/tv'
        ? { results: [{ id: 1, name: '嫁金钗', backdrop_path: '/b.jpg' }] }
        : { name: '嫁金钗', first_air_date: '2026-09-01' }
    )
    const keyword = ref('')
    const { match } = useHeroMatch(keyword, { tmdb: async () => tmdb })
    keyword.value = '嫁金钗 第20集'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(tmdb.mock.calls[0][0]).toBe('/search/tv')
    expect(tmdb.mock.calls[0][1]).toMatchObject({ query: '嫁金钗' })
    expect(match.value).toMatchObject({ kind: 'tv', title: '嫁金钗' })
  })
})

describe('useEpisodeRows', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function setup(titles: string[], input: string) {
    const items = ref(titles.map(share))
    const magnets = ref<MagnetItem[]>([])
    const intent = ref<SearchIntent | null>(parseSearchIntent(input))
    const sort = ref<ReleaseSort>('default')
    const tab = ref('share')
    const rows = useEpisodeRows({
      items,
      magnets,
      intent,
      sort,
      linkOrder: list => list,
      tab: () => tab.value,
    })
    return { items, magnets, intent, rows }
  }

  const titles = [
    '嫁金钗 4K 2160p',
    '嫁金钗 第19集',
    '嫁金钗 更新至24集',
    '嫁金钗 S01E20 1080p',
  ]
  const names = (list: NetdiskItem[]): string[] => list.map(i => i.title)

  it('按这一集分档，别的集折叠，展开后接在最后', async () => {
    const { rows, intent } = setup(titles, '嫁金钗 S01E20')
    expect(names(rows.shareRows.value)).toEqual([
      '嫁金钗 S01E20 1080p',
      '嫁金钗 更新至24集',
      '嫁金钗 4K 2160p',
    ])
    expect(rows.hiddenCount.value).toBe(1)
    expect(rows.othersLabel.value).toBe('其他集 1 条')
    rows.toggleOthers()
    expect(names(rows.shareRows.value).at(-1)).toBe('嫁金钗 第19集')
    expect(rows.othersLabel.value).toBe('收起其他集')
    intent.value = parseSearchIntent('嫁金钗 S01E21')
    await nextTick()
    expect(rows.showOthers.value).toBe(false)
  })

  it('最佳版本只在写明这一集的结果里挑', () => {
    const { rows, items, magnets } = setup(titles, '嫁金钗 S01E20')
    const best = useBestRelease({
      items,
      magnets,
      searched: ref(true),
      error: ref(''),
      candidates: { items: rows.bestShares, magnets: rows.bestMagnets },
    })
    expect(best.bestShare.value?.item.title).toBe('嫁金钗 S01E20 1080p')
    expect(best.summary.value?.shares).toBe(4)
  })

  it('没写集号时原样、不折叠', () => {
    const { rows } = setup(titles, '嫁金钗')
    expect(names(rows.shareRows.value)).toEqual(titles)
    expect(rows.target.value).toBeNull()
    expect(rows.hiddenCount.value).toBe(0)
  })

  it('更新至 / 集区间 / 季区间写法包含这一集时不折叠', () => {
    const list = [
      '嫁金钗 更新至S01E22',
      '嫁金钗 第1集-第24集',
      '嫁金钗 S01-S03',
      '嫁金钗 S02-S03',
    ]
    const { rows } = setup(list, '嫁金钗 S01E20')
    expect(names(rows.shareRows.value)).toEqual(list.slice(0, 3))
    expect(rows.hiddenCount.value).toBe(1)
  })

  it('一条这一集都没有时按钮提示', () => {
    const { rows } = setup(['嫁金钗 第19集'], '嫁金钗 第20集')
    expect(rows.shareRows.value).toEqual([])
    expect(rows.othersLabel.value).toBe('没有这一集 · 其他集 1 条')
  })
})

describe('接线（源码）', () => {
  const read = (p: string): string =>
    readFileSync(`src/renderer/src/features/netdisk/${p}`, 'utf8')

  it('「存到」优先按搜索意图判剧集；预览拿到那一集；工具条可去掉集号', () => {
    const view = read('views/NetdiskView.vue')
    expect(view).toContain('intent.value?.kind ?? match.value?.kind ?? null')
    expect(view).toContain(':episode="rows.target.value"')
    expect(view).toContain('@clear-episode="searchWholeSeries"')
  })

  it('预览高亮那一集的文件', () => {
    const preview = read('components/NetdiskPreview.vue')
    expect(preview).toContain("'is-episode': isEpisode(file)")
    expect(preview).toContain('fileIsEpisode(')
  })
})
