/**
 * 片库浏览胶囊用到的查询：按类型（genres）过滤、facets.list 按顶层类型计数（电影 / 剧集同为 tmdb 来源）、
 * 是否看完（watched）、添加时间下限（addedFrom），以及参数校验。
 * 走 handleRpc：桌面端引擎与独立片库服务（网页 / NAS）用的是同一套 RPC。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  normalizeLibraryQuery,
  parseRpcParams,
} from '../../../src/shared/library/ipc'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'

describe('参数校验', () => {
  const bad = expect.objectContaining({ code: 'invalid-params' })

  it('watched / addedFrom', () => {
    expect(
      normalizeLibraryQuery({ watched: false, addedFrom: 5 })
    ).toMatchObject({ watched: false, addedFrom: 5 })
    expect(normalizeLibraryQuery({}).watched).toBeUndefined()
    expect(() => normalizeLibraryQuery({ watched: 'no' })).toThrow(bad)
    expect(() => normalizeLibraryQuery({ addedFrom: -1 })).toThrow(bad)
    expect(() => normalizeLibraryQuery({ addedFrom: 1.5 })).toThrow(bad)
  })

  it('facets.list 的 types', () => {
    expect(
      parseRpcParams('facets.list', { field: 'tag', types: ['movie'] })
    ).toMatchObject({ types: ['movie'] })
    expect(parseRpcParams('facets.list', { field: 'tag' })).not.toHaveProperty(
      'types'
    )
    expect(() =>
      parseRpcParams('facets.list', { field: 'tag', types: ['episode'] })
    ).toThrow(bad)
  })
})

describe('浏览查询（真实服务）', () => {
  let service: LibraryService

  beforeEach(async () => {
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
  })

  /** 电影库三部、剧集库两部剧（每部剧一季两集，各有文件）；返回各条目 id。 */
  function seed(): Record<string, number> {
    const db = service.db
    const lib = (kind: string): number =>
      Number(
        db
          .prepare(
            `INSERT INTO libraries (root, root_display, kind, name, created_at)
             VALUES (?, ?, ?, ?, 1) RETURNING id`
          )
          .get(`/${kind}`, `/${kind}`, kind, kind)!.id
      )
    const movies = lib('movie')
    const tv = lib('tv')
    const insert = db.prepare(
      `INSERT INTO media_items (library_id, type, parent_id, local_key, title,
         genres, match_state, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, 1) RETURNING id`
    )
    let n = 0
    const add = (
      libraryId: number,
      type: string,
      parent: number | null,
      title: string,
      genres: string[] | null,
      addedAt = 1
    ): number => {
      n++
      const id = Number(
        insert.get(
          libraryId,
          type,
          parent,
          `k${n}`,
          title,
          genres ? JSON.stringify(genres) : null,
          addedAt
        )!.id
      )
      if (type === 'movie' || type === 'episode') {
        const file = Number(
          db
            .prepare(
              `INSERT INTO files (library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at)
               VALUES (?, ?, ?, '/', ?, 'video', 1, 1, 1, 1) RETURNING id`
            )
            .get(libraryId, `/f${n}.mkv`, `/f${n}.mkv`, `f${n}.mkv`)!.id
        )
        db.prepare(
          'INSERT INTO file_media (file_id, item_id) VALUES (?, ?)'
        ).run(file, id)
      }
      return id
    }
    const ids: Record<string, number> = {
      dune: add(movies, 'movie', null, 'Dune', ['科幻', '剧情'], 1000),
      matrix: add(movies, 'movie', null, 'Matrix', ['科幻', '动作'], 10),
      up: add(movies, 'movie', null, 'Up', ['动画'], 20),
      sev: add(tv, 'series', null, 'Severance', ['科幻', '悬疑']),
      fargo: add(tv, 'series', null, 'Fargo', ['犯罪']),
    }
    for (const show of ['sev', 'fargo']) {
      const season = add(tv, 'season', ids[show], `${show} S1`, null)
      ids[`${show}1`] = add(tv, 'episode', season, `${show} E1`, null)
      ids[`${show}2`] = add(tv, 'episode', season, `${show} E2`, null)
    }
    return ids
  }

  /** 标看完。 */
  function watch(...itemIds: number[]): void {
    for (const itemId of itemIds)
      service.db
        .prepare(
          'INSERT INTO watch_progress (item_id, position, duration, watched, updated_at) VALUES (?, 1, 1, 1, 1)'
        )
        .run(itemId)
  }

  async function rpc(method: string, params: unknown): Promise<unknown> {
    const res = await handleRpc(service, {
      method,
      params,
    } as Parameters<typeof handleRpc>[1])
    if (!res.ok) throw new Error(res.error.message)
    return res.result
  }

  const titles = async (query: Record<string, unknown>): Promise<string[]> => {
    const result = (await rpc('query', {
      source: 'tmdb',
      sort: 'title',
      ...query,
    })) as { items: Array<{ title: string }> }
    return result.items.map(i => i.title)
  }

  it('按类型过滤：电影页 / 剧集页各自的类型', async () => {
    seed()
    expect(
      await titles({ types: ['movie'], facets: { tag: ['科幻'] } })
    ).toEqual(['Dune', 'Matrix'])
    expect(
      await titles({ types: ['series'], facets: { tag: ['科幻'] } })
    ).toEqual(['Severance'])
  })

  it('facets.list 按顶层类型计数', async () => {
    seed()
    expect(
      await rpc('facets.list', {
        field: 'tag',
        source: 'tmdb',
        types: ['movie'],
      })
    ).toEqual([
      { value: '科幻', count: 2 },
      { value: '剧情', count: 1 },
      { value: '动作', count: 1 },
      { value: '动画', count: 1 },
    ])
    expect(
      await rpc('facets.list', {
        field: 'tag',
        source: 'tmdb',
        types: ['series'],
      })
    ).toEqual([
      { value: '悬疑', count: 1 },
      { value: '犯罪', count: 1 },
      { value: '科幻', count: 1 },
    ])
    // 不限类型时电影和剧一起算
    const all = (await rpc('facets.list', {
      field: 'tag',
      source: 'tmdb',
    })) as Array<{ value: string; count: number }>
    expect(all.find(v => v.value === '科幻')?.count).toBe(3)
  })

  it('watched：电影看完即可，剧要每一集都看完', async () => {
    const ids = seed()
    watch(ids.matrix, ids.sev1, ids.fargo1, ids.fargo2)
    expect(await titles({ types: ['movie'], watched: false })).toEqual([
      'Dune',
      'Up',
    ])
    expect(await titles({ types: ['movie'], watched: true })).toEqual([
      'Matrix',
    ])
    expect(await titles({ types: ['series'], watched: false })).toEqual([
      'Severance',
    ])
    expect(await titles({ types: ['series'], watched: true })).toEqual([
      'Fargo',
    ])
    // 和类型一起用
    expect(
      await titles({
        types: ['movie'],
        watched: false,
        facets: { tag: ['科幻'] },
      })
    ).toEqual(['Dune'])
  })

  it('addedFrom：只要这之后添加的', async () => {
    seed()
    expect(await titles({ types: ['movie'], addedFrom: 20 })).toEqual([
      'Dune',
      'Up',
    ])
    const result = (await rpc('query', {
      source: 'tmdb',
      types: ['movie'],
      addedFrom: 500,
    })) as { total: number }
    expect(result.total).toBe(1)
  })
})
