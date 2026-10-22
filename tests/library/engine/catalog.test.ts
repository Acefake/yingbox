import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupFile } from '../../../src/main/library/catalog/grouping'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import { parseMediaPath } from '../../../src/shared/library/parser'
import { scanEnv, tempTree } from './helpers'

const group = (
  kind: 'movie' | 'tv',
  relative: string
): ReturnType<typeof groupFile> =>
  groupFile(
    { libraryId: 1, kind, relativeKey: relative },
    parseMediaPath(relative)
  )
const keys = (g: ReturnType<typeof groupFile>): string[] =>
  [...g.ancestors, ...g.leaves].map(i => i.localKey)

describe('groupFile', () => {
  it('电影：同片不同版本落到同一条目，片名繁简与大小写不影响', () => {
    const a = group('movie', '霸王別姬 (1993)/霸王別姬.1993.1080p.mkv')
    const b = group('movie', '霸王别姬.1993.2160p.REMUX.mkv')
    expect(keys(a)).toEqual(keys(b))
    expect(a.leaves[0]).toMatchObject({
      type: 'movie',
      title: '霸王別姬',
      year: 1993,
    })
  })

  it('附加内容不建条目', () => {
    expect(
      keys(group('movie', 'Heat (1995)/Featurettes/Making Of.mkv'))
    ).toEqual([])
  })

  it('剧集：按根下第一层文件夹归剧，季、集各有稳定键', () => {
    const g = group('tv', '绝命毒师/Season 1/Breaking.Bad.S01E02.mkv')
    expect(keys(g)).toEqual([
      'series:1:d:绝命毒师',
      'season:series:1:d:绝命毒师:1',
      'episode:series:1:d:绝命毒师:1:2',
    ])
    // 文件名剧名写法不同，仍是同一部剧
    expect(keys(group('tv', '绝命毒师/Season 1/BB.S01E03.mkv'))[0]).toBe(
      'series:1:d:绝命毒师'
    )
  })

  it('剧集：分类文件夹下的多部剧按各自的作品文件夹分开，不并成一部', () => {
    const a = group(
      'tv',
      '韩剧/鬼謎東宮(2026)/Season 1/鬼謎東宮-S01E02-第 2 集.mkv'
    )
    const b = group(
      'tv',
      '韩剧/努力克服自卑的我们(2026)/Season 1/努力克服自卑的我们-S01E01-可以把你的剧本给我看吗.mkv'
    )
    expect(keys(a)[0]).toBe('series:1:d:韩剧/鬼謎東宮(2026)')
    expect(keys(b)[0]).toBe('series:1:d:韩剧/努力克服自卑的我们(2026)')
    // 没有季文件夹、集直接放在作品文件夹里
    expect(keys(group('tv', '美剧/Severance/Severance.S02E01.mkv'))[0]).toBe(
      'series:1:d:美剧/Severance'
    )
    // Specials 与 Season 1 同属一部剧
    expect(
      keys(group('tv', '韩剧/鬼謎東宮(2026)/Specials/鬼謎東宮-S00E01.mkv'))[0]
    ).toBe('series:1:d:韩剧/鬼謎東宮(2026)')
  })

  it('剧集：只套了季文件夹、没有作品文件夹的按剧名分组', () => {
    expect(keys(group('tv', 'Season 1/Severance.S01E01.mkv'))[0]).toBe(
      'series:1:t:severance'
    )
  })

  it('剧集：绝对集数挂在剧下、无季；多集文件对应多个叶子', () => {
    const abs = group('tv', 'One Piece/[Sub] One Piece - 1071 [1080p].mkv')
    expect(abs.ancestors.map(i => i.type)).toEqual(['series'])
    expect(abs.leaves[0]).toMatchObject({
      seasonNumber: null,
      episodeNumber: 1071,
    })
    const multi = group('tv', 'Show/Show.S01E01E02.mkv')
    expect(multi.leaves.map(l => l.episodeNumber)).toEqual([1, 2])
  })
})

describe('CatalogQuery', () => {
  let tree: ReturnType<typeof tempTree>
  beforeEach(() => {
    tree = tempTree()
  })
  afterEach(() => tree.cleanup())

  async function library(): Promise<ReturnType<typeof scanEnv>> {
    tree.write('霸王別姬 (1993)/霸王別姬 (1993).mkv')
    tree.write('英雄 (2002)/英雄 (2002).mkv')
    tree.write('The Matrix (1999)/The.Matrix.1999.mkv')
    tree.write('Matrix Reloaded (2003)/Matrix.Reloaded.2003.mkv')
    tree.write('Home Video/Home Video.mkv')
    const env = scanEnv(tree.root)
    await env.scan()
    return env
  }

  const list = (
    env: ReturnType<typeof scanEnv>,
    q: Record<string, unknown>
  ): string[] =>
    env.query.list(normalizeLibraryQuery(q)).items.map(i => i.title)

  it('FTS 搜索：繁简互通、大小写不敏感、子串匹配；排序忽略前置冠词', async () => {
    const env = await library()
    expect(list(env, { search: '霸王别姬' })).toEqual(['霸王別姬'])
    expect(list(env, { search: 'MATRIX' })).toEqual([
      'The Matrix',
      'Matrix Reloaded',
    ])
    expect(list(env, { search: 'reload' })).toEqual(['Matrix Reloaded'])
  })

  it('短于 3 个字的搜索走 LIKE 兜底', async () => {
    const env = await library()
    expect(list(env, { search: '英雄' })).toEqual(['英雄'])
    expect(list(env, { search: '%' })).toEqual([])
  })

  it('用户输入的 FTS 语法字符按字面处理', async () => {
    const env = await library()
    expect(list(env, { search: 'matrix" OR "a' })).toEqual([])
    expect(list(env, { search: 'NEAR(matrix' })).toEqual([])
  })

  it('年份排序把无年份的排最后；年份区间筛选', async () => {
    const env = await library()
    expect(list(env, { sort: 'year' })).toEqual([
      'Matrix Reloaded',
      '英雄',
      'The Matrix',
      '霸王別姬',
      'Home Video',
    ])
    expect(
      list(env, { sort: 'year', order: 'asc', yearFrom: 1995, yearTo: 2002 })
    ).toEqual(['The Matrix', '英雄'])
  })

  it('分页：总数不受分页影响，页与页之间不重不漏', async () => {
    const env = await library()
    const all = list(env, {})
    const pages = [0, 2, 4].flatMap(offset => list(env, { offset, limit: 2 }))
    expect(pages).toEqual(all)
    expect(env.query.list(normalizeLibraryQuery({ limit: 2 })).total).toBe(5)
  })

  it('匹配状态筛选', async () => {
    const env = await library()
    env.db.exec(
      "UPDATE media_items SET match_state = 'auto' WHERE title = '英雄'"
    )
    expect(list(env, { matchStates: ['auto'] })).toEqual(['英雄'])
    expect(list(env, { matchStates: ['unmatched'] })).toHaveLength(4)
  })

  it('评分排序：高分在前，无评分的排最后', async () => {
    const env = await library()
    env.db.exec(`UPDATE media_items SET rating = CASE title
      WHEN '霸王別姬' THEN 8.9 WHEN 'The Matrix' THEN 8.2 WHEN '英雄' THEN 7.0
      ELSE NULL END`)
    expect(list(env, { sort: 'rating' }).slice(0, 3)).toEqual([
      '霸王別姬',
      'The Matrix',
      '英雄',
    ])
    expect(list(env, { sort: 'rating', order: 'asc' }).slice(0, 3)).toEqual([
      '英雄',
      'The Matrix',
      '霸王別姬',
    ])
  })
})
