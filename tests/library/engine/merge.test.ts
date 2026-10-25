/**
 * 同一作品多个文件夹的合并展示：海报墙 / 搜索 / 分面去重、详情合并与版本、手动拆分持久化、追剧日历。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { CalendarModule } from '../../../src/main/library/calendar/calendar-module'
import {
  CatalogStore,
  ItemChanges,
} from '../../../src/main/library/catalog/catalog-store'
import { MergeModule } from '../../../src/main/library/catalog/merge/merge-module'
import { CatalogQuery } from '../../../src/main/library/catalog/query'
import {
  type LibraryDb,
  openLibraryDb,
} from '../../../src/main/library/db/database'
import { emitItemChanges } from '../../../src/main/library/identify/identify-events'
import {
  type LibraryRecord,
  LibraryStore,
} from '../../../src/main/library/libraries/library-store'
import { fingerprintFile } from '../../../src/main/library/scanner/fingerprint'
import { scanLibrary } from '../../../src/main/library/scanner/scan-library'
import { ScanStore } from '../../../src/main/library/scanner/scan-store'
import {
  type LibraryEvent,
  type LibraryItemNode,
  type LibraryKind,
  type LibraryQueryResult,
  type LibraryQueryResult,
  normalizeLibraryQuery,
} from '../../../src/shared/library/ipc'
import { tempTree } from './helpers'

/** 两个媒体库的测试环境。 */
interface TwoLibraries {
  a: ReturnType<typeof tempTree>
  b: ReturnType<typeof tempTree>
  db: LibraryDb
  libA: LibraryRecord
  libB: LibraryRecord
  scan: () => Promise<void>
  merge: MergeModule
  events: LibraryEvent[]
  query: CatalogQuery
  cleanup: () => void
}

/** 一个数据库、两个同类媒体库（不同盘），真实扫描。 */
function twoLibraries(kind: LibraryKind): TwoLibraries {
  const a = tempTree()
  const b = tempTree()
  const db = openLibraryDb(':memory:')
  const store = new LibraryStore(db)
  const libA = store.add({ root: a.root, kind }, 1)
  const libB = store.add({ root: b.root, kind }, 1)
  const scanStore = new ScanStore(db)
  const catalog = new CatalogStore(db)
  const events: LibraryEvent[] = []
  const merge = new MergeModule({ db, emit: e => events.push(e) })
  const scan = async (): Promise<void> => {
    for (const lib of [libA, libB]) {
      await scanLibrary(
        {
          db,
          scanStore,
          catalog,
          fingerprint: f => fingerprintFile(f.displayPath),
        },
        lib
      )
    }
  }
  return {
    a,
    b,
    db,
    libA,
    libB,
    scan,
    merge,
    events,
    query: new CatalogQuery(db),
    cleanup: () => {
      db.close()
      a.cleanup()
      b.cleanup()
    },
  }
}

/** 模拟识别结果：把某库的顶层条目匹配到 tmdb id。 */
function identify(db: LibraryDb, libraryId: number, tmdbId: string): number[] {
  return db
    .prepare(
      `UPDATE media_items SET tmdb_id = ?, match_state = 'auto',
         genres = '["剧情"]'
       WHERE library_id = ? AND parent_id IS NULL RETURNING id`
    )
    .all(tmdbId, libraryId)
    .map(r => Number(r.id))
}

const list = (
  env: { query: CatalogQuery },
  q: Record<string, unknown> = {}
): LibraryQueryResult => env.query.list(normalizeLibraryQuery(q))

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('电影：两个盘里的同一部电影', () => {
  async function setup(): Promise<{
    env: TwoLibraries
    idA: number
    idB: number
  }> {
    const env = twoLibraries('movie')
    cleanup = env.cleanup
    env.a.write('Heat (1995)/Heat.1995.1080p.BluRay.mkv', 'x'.repeat(10))
    env.b.write('盗火线 (1995)/盗火线.1995.2160p.UHD.HDR.mkv', 'x'.repeat(20))
    env.b.write('Other (2001)/Other.2001.mkv')
    await env.scan()
    const [idA] = identify(env.db, env.libA.id, '949')
    const idB = Number(
      env.db
        .prepare(
          "UPDATE media_items SET tmdb_id = '949', match_state = 'locked' WHERE library_id = ? AND title LIKE '盗火线%' RETURNING id"
        )
        .get(env.libB.id)!.id
    )
    return { env, idA, idB }
  }

  it('识别前各自显示；识别到同一 id 后海报墙只出现一次，总数随之变化', async () => {
    const env = twoLibraries('movie')
    cleanup = env.cleanup
    env.a.write('Heat (1995)/Heat.1995.mkv')
    env.b.write('Heat (1995)/Heat.1995.mkv')
    await env.scan()
    expect(list(env).total).toBe(2)
    identify(env.db, env.libA.id, '949')
    identify(env.db, env.libB.id, '949')
    const page = list(env)
    expect(page.total).toBe(1)
    expect(page.items).toHaveLength(1)
  })

  it('任何筛选下整组恰好出现一次：只有另一份满足搜索 / 媒体库条件时显示那一份', async () => {
    const { env, idA, idB } = await setup()
    // 默认由 id 最小的那份代表整组
    const all = list(env)
    expect(all.total).toBe(2)
    expect(all.items.map(i => i.id)).toContain(idA)
    expect(all.items.map(i => i.id)).not.toContain(idB)
    // 只有 B 的本地片名里有「盗火线」：搜它时由 B 代表整组
    expect(list(env, { search: '盗火线' }).items.map(i => i.id)).toEqual([idB])
    // 限定媒体库：各库都看得到自己那份
    expect(list(env, { libraryId: env.libA.id }).items.map(i => i.id)).toEqual([
      idA,
    ])
    expect(list(env, { libraryId: env.libB.id }).total).toBe(2)
    // 状态筛选：只有 B 是 locked
    expect(list(env, { matchStates: ['locked'] }).items.map(i => i.id)).toEqual(
      [idB]
    )
  })

  it('分面计数按作品算一次', async () => {
    const { env } = await setup()
    env.db.exec(
      `UPDATE media_items SET genres = '["剧情"]' WHERE tmdb_id = '949'`
    )
    expect(
      env.query.facetValues({ field: 'tag' }).find(v => v.value === '剧情')
    ).toEqual({ value: '剧情', count: 1 })
    expect(list(env, { facets: { tag: ['剧情'] } }).total).toBe(1)
  })

  it('海报墙的动态范围标取整组最好的一档', async () => {
    const { env, idA } = await setup()
    env.db.exec("UPDATE files SET video_range = 'dv' WHERE name LIKE '盗火线%'")
    const summary = list(env).items.find(i => i.providerIds.tmdb === '949')!
    expect(summary.id).toBe(idA)
    expect(summary.videoRange).toBe('dv')
  })

  it('详情合并两份文件，版本按分辨率排，默认是 2160p；带成员与来源文件夹', async () => {
    const { env, idA, idB } = await setup()
    const node = env.merge.getItem(idA)!
    expect(node.id).toBe(idA)
    expect(node.files.filter(f => f.kind === 'video')).toHaveLength(2)
    expect(node.versions!.map(v => [v.height, v.range, v.itemId])).toEqual([
      [2160, 'hdr10', idB],
      [1080, null, idA],
    ])
    expect(node.versions![0].folder).toContain('盗火线 (1995)')
    expect(node.merge!.members.map(m => m.itemId)).toEqual([idA, idB])
    expect(node.merge!.splitFrom).toBe(0)
    // 内部读单个本地条目（写出 / 整理用）不受影响
    expect(
      env.query.getItem(idA)!.files.filter(f => f.kind === 'video')
    ).toHaveLength(1)
  })

  it('拆分持久化：拆出后两条各自显示，恢复后再合并；改匹配后拆分自动失效', async () => {
    const { env, idA, idB } = await setup()
    env.merge.split({ itemId: idB })
    expect(list(env).total).toBe(3)
    expect(env.merge.getItem(idA)!.merge).toBeUndefined()
    expect(env.merge.getItem(idB)!.merge).toEqual({
      members: [expect.objectContaining({ itemId: idB })],
      splitFrom: 1,
    })
    // 推送：两库各一条，涉及的条目按结构变化
    expect(env.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ libraryId: env.libA.id, added: [idA] }),
        expect.objectContaining({ libraryId: env.libB.id, added: [idB] }),
      ])
    )
    expect(env.events).toHaveLength(2)
    // 重新打开数据库连接后仍然是拆开的（记在条目上）
    expect(new CatalogQuery(env.db).list(normalizeLibraryQuery({})).total).toBe(
      3
    )

    env.merge.join({ itemId: idB })
    expect(list(env).total).toBe(2)

    env.merge.split({ itemId: idB })
    env.db
      .prepare("UPDATE media_items SET tmdb_id = '1000' WHERE id = ?")
      .run(idB)
    env.db
      .prepare(
        "UPDATE media_items SET tmdb_id = '1000', match_state = 'auto' WHERE title = 'Other'"
      )
      .run()
    // B 改匹配到 1000：之前对 949 的拆分不再生效，和同为 1000 的 Other 合并
    expect(list(env).total).toBe(2)
  })

  it('识别推送：并进别的文件夹同一作品的条目按结构变化推送，单独的仍是原地更新', async () => {
    const { env, idA, idB } = await setup()
    const other = list(env).items.find(i => i.title === 'Other')!.id
    const changes = new ItemChanges()
    for (const id of [idA, idB, other]) changes.updated.add(id)
    const events: LibraryEvent[] = []
    emitItemChanges(env.db, e => events.push(e), changes)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ libraryId: env.libA.id, added: [idA] }),
        expect.objectContaining({
          libraryId: env.libB.id,
          added: [idB],
          updated: expect.arrayContaining([idB, other]),
        }),
      ])
    )
  })

  it('未匹配 / 待确认的条目不参与合并，拆分只接受已匹配的顶层条目', async () => {
    const env = twoLibraries('movie')
    cleanup = env.cleanup
    env.a.write('Heat (1995)/Heat.1995.mkv')
    env.b.write('Heat (1995)/Heat.1995.mkv')
    await env.scan()
    env.db.exec(
      "UPDATE media_items SET tmdb_id = '949', match_state = 'review'"
    )
    expect(list(env).total).toBe(2)
    const id = list(env).items[0].id
    env.db.exec('UPDATE media_items SET tmdb_id = NULL')
    expect(() => env.merge.split({ itemId: id })).toThrow(/已匹配/)
  })
})

describe('剧集：两个文件夹各有部分集', () => {
  async function setup(): Promise<{
    env: TwoLibraries
    idA: number
    idB: number
  }> {
    const env = twoLibraries('tv')
    cleanup = env.cleanup
    env.a.write('Severance/Season 1/Severance.S01E01.1080p.mkv', 'x')
    env.a.write('Severance/Season 1/Severance.S01E02.1080p.mkv', 'x')
    env.b.write('人生切割术/Season 1/Severance.S01E02.2160p.mkv', 'xx')
    env.b.write('人生切割术/Season 1/Severance.S01E03.2160p.mkv', 'xx')
    env.b.write('人生切割术/Season 2/Severance.S02E01.2160p.mkv', 'xx')
    await env.scan()
    const [idA] = identify(env.db, env.libA.id, '95396')
    const [idB] = identify(env.db, env.libB.id, '95396')
    return { env, idA, idB }
  }

  const episodes = (season: LibraryItemNode): Array<[number | null, number]> =>
    season.children.map(ep => [ep.episodeNumber, ep.versions?.length ?? 0])

  it('合并成完整的季，同一集的多个文件成为版本', async () => {
    const { env, idA, idB } = await setup()
    expect(list(env).total).toBe(1)
    const node = env.merge.getItem(idB)!
    expect(node.id).toBe(idB)
    expect(node.children.map(s => s.seasonNumber)).toEqual([1, 2])
    expect(episodes(node.children[0])).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ])
    const e2 = node.children[0].children[1]
    expect(e2.versions!.map(v => [v.height, v.itemId])).toEqual([
      [2160, idB],
      [1080, idA],
    ])
    expect(node.merge!.members.map(m => m.folder)).toEqual([
      expect.stringMatching(/Severance$/),
      expect.stringMatching(/人生切割术$/),
    ])
  })

  it('追剧日历只列一次，本地集在两个文件夹里都找', async () => {
    const { env, idA } = await setup()
    const calendar = new CalendarModule({
      db: env.db,
      provider: () => ({
        configured: true,
        airing: async () => ({
          id: 95396,
          status: 'Returning Series',
          seasons: [{ season_number: 1, air_date: '2026-10-01' }],
        }),
        airingSeason: async () => ({
          season_number: 1,
          episodes: [1, 3].map(n => ({
            season_number: 1,
            episode_number: n,
            air_date: '2026-10-20',
          })),
        }),
      }),
    })
    const result = await calendar.episodes({
      from: '2026-10-19',
      to: '2026-10-25',
    })
    expect(result.series).toBe(1)
    expect(
      result.episodes.map(e => [e.seriesId, e.episode, Boolean(e.fileId)])
    ).toEqual([
      [idA, 1, true],
      [idA, 3, true],
    ])
  })
})
