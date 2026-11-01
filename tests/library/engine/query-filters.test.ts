/**
 * 海报墙附加筛选（自然语言搜索用）：参数校验，以及真实服务上按评分下限、制片国家、有无类型、
 * 人名（演职员名 / 原名包含匹配）、条目 id 白名单 / 黑名单过滤。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type LibraryQuery,
  normalizeLibraryQuery,
} from '../../../src/shared/library/ipc'
import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from './helpers'

describe('附加筛选参数校验', () => {
  it('规整取值，空列表视为不筛选；ids 空数组保留；非法值拒绝', () => {
    expect(
      normalizeLibraryQuery({
        ratingMin: 8,
        countries: [' kr ', 'KR'],
        people: [' 诺兰 ', ''],
        excludeIds: [3, 3],
      })
    ).toMatchObject({
      ratingMin: 8,
      countries: ['KR'],
      people: ['诺兰'],
      excludeIds: [3],
    })
    const plain = normalizeLibraryQuery({ countries: [], people: [] })
    expect(plain).not.toHaveProperty('countries')
    expect(plain).not.toHaveProperty('ratingMin')
    expect(normalizeLibraryQuery({ ids: [] }).ids).toEqual([])
    expect(normalizeLibraryQuery({ hasGenres: false }).hasGenres).toBe(false)
    expect(plain).not.toHaveProperty('hasGenres')
    const bad = expect.objectContaining({ code: 'invalid-params' })
    expect(() => normalizeLibraryQuery({ hasGenres: 'yes' })).toThrow(bad)
    expect(() => normalizeLibraryQuery({ ratingMin: 11 })).toThrow(bad)
    expect(() => normalizeLibraryQuery({ people: [1] })).toThrow(bad)
    expect(() => normalizeLibraryQuery({ ids: [0] })).toThrow(bad)
  })
})

describe('按附加筛选查询（真实服务）', () => {
  let tree: ReturnType<typeof tempTree>
  let service: LibraryService

  beforeEach(async () => {
    tree = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    tree.cleanup()
  })

  /** 文件名 → 识别后的资料。 */
  const MOVIES: Record<
    string,
    {
      rating: number
      countries: string[]
      cast: Array<{ name: string; originalName?: string }>
      crew: Array<{ name: string; originalName?: string; job: string }>
    }
  > = {
    Inception: {
      rating: 8.4,
      countries: ['US', 'GB'],
      cast: [
        { name: '莱昂纳多·迪卡普里奥', originalName: 'Leonardo DiCaprio' },
      ],
      crew: [
        {
          name: '克里斯托弗·诺兰',
          originalName: 'Christopher Nolan',
          job: 'Director',
        },
      ],
    },
    Parasite: {
      rating: 8.5,
      countries: ['KR'],
      cast: [{ name: '宋康昊' }],
      crew: [{ name: '奉俊昊', job: 'Director' }],
    },
    Tenet: {
      rating: 7.2,
      countries: ['US'],
      cast: [],
      crew: [{ name: '克里斯托弗·诺兰', job: 'Director' }],
    },
  }

  async function setup(): Promise<Map<string, number>> {
    for (const name of Object.keys(MOVIES)) tree.write(`${name}.mp4`)
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { identify: false, watch: false },
    })
    await service.queue.idle()
    const rows = service.db
      .prepare('SELECT id, title FROM media_items')
      .all() as Array<{ id: number; title: string }>
    const ids = new Map<string, number>()
    for (const row of rows) {
      const m = MOVIES[row.title]
      if (!m) continue
      ids.set(row.title, row.id)
      service.db
        .prepare('UPDATE media_items SET rating = ?, metadata = ? WHERE id = ?')
        .run(
          m.rating,
          JSON.stringify({
            countries: m.countries,
            cast: m.cast,
            crew: m.crew,
          }),
          row.id
        )
    }
    return ids
  }

  const titles = (q: LibraryQuery): string[] =>
    service
      .query(normalizeLibraryQuery({ types: ['movie'], sort: 'title', ...q }))
      .items.map(i => i.title)

  it('评分下限、国家、人名、id 白 / 黑名单，同时给出时同时满足', async () => {
    const ids = await setup()
    expect(titles({})).toEqual(['Inception', 'Parasite', 'Tenet'])
    expect(titles({ ratingMin: 8 })).toEqual(['Inception', 'Parasite'])
    expect(titles({ countries: ['GB', 'KR'] })).toEqual([
      'Inception',
      'Parasite',
    ])
    expect(titles({ people: ['诺兰'] })).toEqual(['Inception', 'Tenet'])
    expect(titles({ people: ['nolan'] })).toEqual(['Inception'])
    expect(titles({ people: ['诺兰', '迪卡普里奥'] })).toEqual(['Inception'])
    expect(titles({ people: ['50%_'] })).toEqual([])
    expect(titles({ ids: [ids.get('Tenet')!] })).toEqual(['Tenet'])
    expect(titles({ ids: [] })).toEqual([])
    expect(titles({ excludeIds: [ids.get('Tenet')!] })).toEqual([
      'Inception',
      'Parasite',
    ])
    expect(
      titles({ people: ['诺兰'], ratingMin: 8, countries: ['US'] })
    ).toEqual(['Inception'])
  })

  it('有无类型：genres 非空才算有，空数组与 NULL 都算没有', async () => {
    const ids = await setup()
    const setGenres = (title: string, genres: string | null): void => {
      service.db
        .prepare('UPDATE media_items SET genres = ? WHERE id = ?')
        .run(genres, ids.get(title)!)
    }
    setGenres('Inception', '["科幻"]')
    setGenres('Parasite', '[]')
    expect(titles({ hasGenres: true })).toEqual(['Inception'])
    expect(titles({ hasGenres: false })).toEqual(['Parasite', 'Tenet'])
  })

  it('内容类别：类型 id 或类型名互斥归类，纪录片 > 综艺 > 动漫，其余（含没有类型）是普通', async () => {
    const ids = await setup()
    const setGenres = (title: string, genres: string | null): void => {
      service.db
        .prepare('UPDATE media_items SET genres = ? WHERE id = ?')
        .run(genres, ids.get(title)!)
    }
    setGenres('Inception', '["动画","真人秀"]')
    setGenres('Parasite', '["Documentary"]')
    // 日文元数据：类型名认不出，按 metadata.genreIds（16 = 动画）归类
    service.db
      .prepare('UPDATE media_items SET genres = ?, metadata = ? WHERE id = ?')
      .run(
        '["アニメーション"]',
        JSON.stringify({ level: 'title', genreIds: [16] }),
        ids.get('Tenet')!
      )
    expect(titles({ category: 'variety' })).toEqual(['Inception'])
    expect(titles({ category: 'documentary' })).toEqual(['Parasite'])
    expect(titles({ category: 'anime' })).toEqual(['Tenet'])
    expect(titles({ category: 'plain' })).toEqual([])
    expect(() => normalizeLibraryQuery({ category: 'kids' })).toThrow()
  })
})
