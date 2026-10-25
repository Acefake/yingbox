/**
 * 本地 NFO 补全（真实引擎 + 假 TMDB）：TMDB 匹配失败、没配 TMDB、TMDB 缺字段时，
 * 用 NFO 的类型 / 国家 / 评分 / 简介 / 年份补空字段；TMDB 已有的值不覆盖；番号库不碰。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import { normalizeLibraryQuery as q } from '../../../src/shared/library/ipc'
import { tempTree } from '../engine/helpers'
import { FAKE_TOKEN, FakeTmdb } from '../providers/fake-tmdb'

let tree: ReturnType<typeof tempTree>
beforeEach(() => {
  tree = tempTree()
})
afterEach(() => tree.cleanup())

const NFO = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>无名之辈外传</title>
  <plot><![CDATA[一个小镇青年的荒诞一天 &amp; 他的朋友们。]]></plot>
  <genre>喜剧</genre>
  <genre>剧情 / 犯罪</genre>
  <country>中国大陆</country>
  <ratings><rating name="douban" max="10" default="true"><value>7.8</value></rating></ratings>
  <premiered>2001-05-01</premiered>
</movie>`

interface Row {
  title: string
  state: string
  genres: string[]
  overview: string | null
  rating: number | null
  year: number | null
  metadata: Record<string, unknown> | null
}

async function engine(
  files: Record<string, string>,
  options: { token?: boolean; source?: 'tmdb' | 'jav' } = {}
): Promise<{ service: LibraryService; tmdb: FakeTmdb; rows: () => Row[] }> {
  for (const [path, content] of Object.entries(files)) tree.write(path, content)
  const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
  const service = new LibraryService({
    dbPath: ':memory:',
    watch: false,
    identify: {
      fetch: tmdb.fetch,
      env: options.token === false ? {} : { tmdbToken: FAKE_TOKEN },
    },
  })
  await service.start()
  await service.addLibrary({
    root: tree.root,
    kind: 'movie',
    ...(options.source ? { source: options.source } : {}),
  })
  await service.queue.idle()
  const rows = (): Row[] =>
    service.db
      .prepare(
        `SELECT title, match_state, genres, overview, rating, year, metadata
         FROM media_items WHERE parent_id IS NULL ORDER BY id`
      )
      .all()
      .map(r => ({
        title: String(r.title),
        state: String(r.match_state),
        genres: r.genres ? (JSON.parse(String(r.genres)) as string[]) : [],
        overview: r.overview === null ? null : String(r.overview),
        rating: r.rating === null ? null : Number(r.rating),
        year: r.year === null ? null : Number(r.year),
        metadata: r.metadata ? JSON.parse(String(r.metadata)) : null,
      }))
  return { service, tmdb, rows }
}

describe('NFO 补全', () => {
  it('TMDB 搜不到：用 NFO 补类型、简介、评分、年份，国家写进 local 元数据', async () => {
    const { service, rows } = await engine({
      'Wuming.Waizhuan.mkv': '',
      'Wuming.Waizhuan.nfo': NFO,
    })
    const [row] = rows()
    expect(row.state).toBe('unmatched')
    expect(row.genres).toEqual(['喜剧', '剧情', '犯罪'])
    expect(row.overview).toBe('一个小镇青年的荒诞一天 & 他的朋友们。')
    expect(row.rating).toBe(7.8)
    expect(row.year).toBe(2001)
    expect(row.metadata).toEqual({
      level: 'local',
      countries: ['CN'],
      source: 'nfo',
    })
    // 海报墙的类型 / 地区筛选能用上这些值
    expect(service.query(q({ facets: { tag: ['喜剧'] } })).total).toBe(1)
    expect(service.query(q({ countries: ['CN'] })).total).toBe(1)
    expect(service.query(q({ hasGenres: true })).total).toBe(1)
    expect(service.query(q({ hasGenres: false })).total).toBe(0)
    await service.close()
  })

  it('TMDB 已有的值不覆盖，只补 TMDB 缺的字段', async () => {
    const { service, tmdb, rows } = await engine({})
    // TMDB 这部片没有简介：NFO 的简介补上，类型 / 国家仍用 TMDB 的
    const heat = tmdb.fixtures.get('/movie/949') as Record<string, unknown>
    heat.overview = ''
    heat.translations = { translations: [] }
    tree.write('Heat.1995.1080p.mkv', '')
    tree.write(
      'Heat.1995.1080p.nfo',
      '<movie><plot>NFO 简介</plot><genre>Foo</genre><country>日本</country></movie>'
    )
    const lib = service.listLibraries()[0]
    service.scan({ libraryId: lib.id })
    await service.queue.idle()
    const [row] = rows()
    expect(row.state).toBe('auto')
    expect(row.genres).toEqual(['犯罪', '剧情'])
    expect(row.overview).toBe('NFO 简介')
    expect((row.metadata as { countries: string[] }).countries).toEqual(['US'])
    await service.close()
  })

  it('没配 TMDB：库里有 NFO 时照样排一次识别，只做本地补全、不请求 TMDB', async () => {
    const { service, tmdb, rows } = await engine(
      { 'Wuming.Waizhuan.mkv': '', 'Wuming.Waizhuan.nfo': NFO },
      { token: false }
    )
    const [row] = rows()
    expect(row.state).toBe('unmatched')
    expect(row.genres).toEqual(['喜剧', '剧情', '犯罪'])
    expect(tmdb.count('/search')).toBe(0)
    await service.close()
  })
})
