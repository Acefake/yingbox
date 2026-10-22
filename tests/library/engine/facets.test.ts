/**
 * 分面筛选：番号类别判定、参数校验、海报墙按分面过滤（标签全部满足、其余任一），
 * 以及 facets.list 的计数、搜索与范围。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type FacetFilter,
  normalizeLibraryQuery,
  parseRpcParams,
} from '../../../src/shared/library/ipc'
import { javKindOf } from '../../../src/main/library/catalog/jav-kind'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from './helpers'

describe('javKindOf', () => {
  it('有码 / 无码 / FC2 / 素人；认不出为 null', () => {
    expect(javKindOf('SSIS-497')).toBe('censored')
    expect(javKindOf('HEYZO-0841')).toBe('uncensored')
    expect(javKindOf('FC2-PPV-1234567')).toBe('fc2')
    expect(javKindOf('259LUXU-1234')).toBe('amateur')
    expect(javKindOf('550')).toBeNull()
  })
})

describe('facets 参数校验', () => {
  it('去空白去重，空分面去掉；非法值拒绝', () => {
    expect(normalizeLibraryQuery({}).facets).toBeUndefined()
    expect(
      normalizeLibraryQuery({
        facets: { tag: [' 巨乳 ', '巨乳', ''], actor: [] },
      }).facets
    ).toEqual({ tag: ['巨乳'] })
    expect(
      normalizeLibraryQuery({ facets: { tag: [] } }).facets
    ).toBeUndefined()
    const bad = expect.objectContaining({ code: 'invalid-params' })
    expect(() => normalizeLibraryQuery({ facets: { kind: ['vr'] } })).toThrow(
      bad
    )
    expect(() => normalizeLibraryQuery({ facets: { tag: [1] } })).toThrow(bad)
    expect(() => parseRpcParams('facets.list', { field: 'genre' })).toThrow(bad)
    expect(parseRpcParams('facets.list', { field: 'tag' })).toMatchObject({
      field: 'tag',
      limit: 60,
    })
  })
})

describe('按分面查询（真实服务）', () => {
  let jav: ReturnType<typeof tempTree>
  let service: LibraryService

  beforeEach(async () => {
    jav = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    jav.cleanup()
  })

  /** 番号 → 识别后的资料；ABP-123 当作还没识别。 */
  const MOVIES: Record<
    string,
    {
      tags: string[]
      studio: string
      series?: string
      director?: string
      actors: string[]
    }
  > = {
    'SSIS-497': {
      tags: ['巨乳', '单体作品'],
      studio: 'S1',
      series: '系列A',
      director: '导演甲',
      actors: ['三上悠亚'],
    },
    'SSIS-500': {
      tags: ['巨乳'],
      studio: 'S1',
      series: '系列A',
      actors: ['三上悠亚', '河北彩花'],
    },
    'HEYZO-0841': { tags: ['单体作品'], studio: 'HEYZO', actors: ['河北彩花'] },
    'FC2-PPV-1234567': { tags: [], studio: 'FC2', actors: [] },
  }

  async function setup(): Promise<void> {
    for (const code of [...Object.keys(MOVIES), 'ABP-123'])
      jav.write(`${code}.mp4`)
    await service.addLibrary({
      root: jav.root,
      kind: 'movie',
      source: 'jav',
      automation: { identify: false, watch: false },
    })
    await service.queue.idle()
    const db = service.db
    const rows = db
      .prepare('SELECT id, upper(title) AS code FROM media_items')
      .all() as Array<{ id: number; code: string }>
    let actorId = 0
    const actorIds = new Map<string, number>()
    for (const row of rows) {
      const m = MOVIES[row.code]
      if (!m) continue
      const metadata = {
        companies: [m.studio],
        crew: m.director
          ? [{ id: m.director, name: m.director, job: 'Director' }]
          : [],
        ...(m.series ? { collection: { id: m.series, name: m.series } } : {}),
      }
      db.prepare(
        'UPDATE media_items SET tmdb_id = ?, genres = ?, metadata = ? WHERE id = ?'
      ).run(row.code, JSON.stringify(m.tags), JSON.stringify(metadata), row.id)
      for (const name of m.actors) {
        if (!actorIds.has(name)) {
          actorIds.set(name, ++actorId)
          db.prepare(
            'INSERT INTO actors (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, 0, 0)'
          ).run(actorId, name, name)
        }
        db.prepare(
          'INSERT INTO item_actors (item_id, actor_id) VALUES (?, ?)'
        ).run(row.id, actorIds.get(name)!)
      }
    }
  }

  const codes = (facets?: FacetFilter): string[] =>
    service
      .query(
        normalizeLibraryQuery({
          source: 'jav',
          types: ['movie'],
          sort: 'title',
          facets,
        })
      )
      .items.map(i => i.title.toUpperCase())

  it('分面之间同时满足；标签全部满足，其余任一', async () => {
    await setup()
    expect(codes()).toHaveLength(5)
    expect(codes({ kind: ['censored'] })).toEqual(['SSIS-497', 'SSIS-500'])
    expect(codes({ kind: ['uncensored', 'fc2'] })).toEqual([
      'FC2-PPV-1234567',
      'HEYZO-0841',
    ])
    expect(codes({ tag: ['巨乳'] })).toEqual(['SSIS-497', 'SSIS-500'])
    expect(codes({ tag: ['巨乳', '单体作品'] })).toEqual(['SSIS-497'])
    expect(codes({ studio: ['S1', 'HEYZO'] })).toHaveLength(3)
    expect(codes({ series: ['系列A'] })).toEqual(['SSIS-497', 'SSIS-500'])
    expect(codes({ director: ['导演甲'] })).toEqual(['SSIS-497'])
    expect(codes({ actor: ['河北彩花'] })).toEqual(['HEYZO-0841', 'SSIS-500'])
    expect(codes({ actor: ['河北彩花'], kind: ['censored'] })).toEqual([
      'SSIS-500',
    ])
  })

  it('facets.list：按条目数降序，可搜索，可限定来源', async () => {
    await setup()
    const list = async (params: Record<string, unknown>): Promise<unknown> => {
      const res = await handleRpc(service, { method: 'facets.list', params })
      if (!res.ok) throw new Error(res.error.message)
      return res.result
    }
    expect(await list({ field: 'tag', source: 'jav' })).toEqual([
      { value: '单体作品', count: 2 },
      { value: '巨乳', count: 2 },
    ])
    expect(await list({ field: 'kind', source: 'jav' })).toEqual([
      { value: 'censored', count: 2 },
      { value: 'fc2', count: 1 },
      { value: 'uncensored', count: 1 },
    ])
    expect(await list({ field: 'actor', source: 'jav', search: '彩' })).toEqual(
      [{ value: '河北彩花', count: 2 }]
    )
    expect(await list({ field: 'director', source: 'jav' })).toEqual([
      { value: '导演甲', count: 1 },
    ])
    expect(await list({ field: 'studio', source: 'tmdb' })).toEqual([])
  })
})
