/**
 * 占位剧条目（ADR-0049）：在线剧追更要先在片库里有一个没有文件的剧条目。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CalendarModule,
  type CalendarProvider,
} from '../../../src/main/library/calendar/calendar-module'
import { PlaceholderSeries } from '../../../src/main/library/calendar/placeholder-series'
import { MergeStore } from '../../../src/main/library/catalog/merge/merge-store'
import { CatalogQuery } from '../../../src/main/library/catalog/query'
import {
  type LibraryDb,
  openLibraryDb,
} from '../../../src/main/library/db/database'
import { LibraryStore } from '../../../src/main/library/libraries/library-store'
import {
  type ApplyMatchRequest,
  type ApplyMatchResult,
  LibraryError,
  normalizeLibraryQuery,
} from '../../../src/shared/library/ipc'
import { tempTree } from './helpers'

interface Env {
  db: LibraryDb
  placeholder: PlaceholderSeries
  libraryId: number
  /** 假匹配：按标题查表，返回匹配状态与候选 */
  requests: ApplyMatchRequest[]
  cleanup: () => void
}

/** 标题 → TMDB id；表里没有但在 maybe 里的算「多个候选」。 */
function setup(
  table: Record<string, string>,
  maybe: string[] = [],
  withLibrary = true
): Env {
  const tree = tempTree()
  const db = openLibraryDb(':memory:')
  const libraryId = withLibrary
    ? new LibraryStore(db).add({ root: tree.root, kind: 'tv' }, 1).id
    : 0
  const requests: ApplyMatchRequest[] = []
  const match = async (
    request: ApplyMatchRequest
  ): Promise<ApplyMatchResult> => {
    requests.push(request)
    const title = request.query?.title ?? ''
    const tmdbId = request.tmdbId ?? table[title]
    if (!tmdbId) {
      const candidates = maybe.includes(title)
        ? [
            {
              provider: 'tmdb' as const,
              kind: 'tv' as const,
              id: '7',
              title,
              originalTitle: null,
              year: 2024,
              confidence: 0.5,
              breakdown: {},
              poster: null,
              overview: null,
            },
          ]
        : []
      return {
        status: candidates.length ? 'review' : 'unmatched',
        item: null,
        candidates,
      }
    }
    db.prepare(
      `UPDATE media_items SET tmdb_id = ?, match_state = 'auto' WHERE id = ?`
    ).run(tmdbId, request.itemId)
    return {
      status: 'matched',
      item: { providerIds: { tmdb: tmdbId } } as ApplyMatchResult['item'],
      candidates: [],
    }
  }
  return {
    db,
    placeholder: new PlaceholderSeries({ db, match }),
    libraryId,
    requests,
    cleanup: tree.cleanup,
  }
}

let env: Env | null = null
afterEach(() => {
  env?.cleanup()
  env = null
})

const rows = (db: LibraryDb): Array<Record<string, unknown>> =>
  db.prepare('SELECT * FROM media_items').all()

describe('占位剧条目', () => {
  it('剧名匹配成功：建一个锁定匹配的空剧条目，键按 TMDB id', async () => {
    env = setup({ 小城良方: '1001' })
    const result = await env.placeholder.ensure({
      title: '小城良方',
      year: 2024,
    })
    expect(result).toMatchObject({ status: 'ready', created: true })
    const all = rows(env.db)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      type: 'series',
      local_key: 'placeholder:tmdb:1001',
      match_state: 'locked',
      tmdb_id: '1001',
      library_id: env.libraryId,
    })
    expect(env.requests[0].query).toEqual({ title: '小城良方', year: 2024 })
  })

  it('再追同一部剧不会重复建（幂等）；指定 tmdbId 直接复用', async () => {
    env = setup({ 小城良方: '1001' })
    const first = await env.placeholder.ensure({ title: '小城良方' })
    const again = await env.placeholder.ensure({ title: '小城良方' })
    const byId = await env.placeholder.ensure({ title: '别名', tmdbId: '1001' })
    expect(again).toMatchObject({ status: 'ready', created: false })
    expect(byId).toMatchObject({ status: 'ready', created: false })
    if (first.status === 'ready' && again.status === 'ready')
      expect(again.itemId).toBe(first.itemId)
    expect(rows(env.db)).toHaveLength(1)
    // 指定 tmdbId 的复用不再走匹配
    expect(env.requests).toHaveLength(2)
  })

  it('片库里已有同一部剧的真实条目：用它，不建占位', async () => {
    env = setup({ 蒸蒸日上: '2002' })
    const real = Number(
      env.db
        .prepare(
          `INSERT INTO media_items (library_id, type, local_key, title, tmdb_id,
             match_state, added_at, updated_at)
           VALUES (?, 'series', 'k:real', '蒸蒸日上', '2002', 'auto', 1, 1) RETURNING id`
        )
        .get(env.libraryId)!.id
    )
    const result = await env.placeholder.ensure({ title: '蒸蒸日上' })
    expect(result).toEqual({ status: 'ready', itemId: real, created: false })
    expect(rows(env.db)).toHaveLength(1)
  })

  it('匹配不确定：删掉临时行，把候选交给调用方；找不到返回 none', async () => {
    env = setup({}, ['模糊'])
    expect(await env.placeholder.ensure({ title: '模糊' })).toMatchObject({
      status: 'choose',
    })
    expect(await env.placeholder.ensure({ title: '查无此剧' })).toEqual({
      status: 'none',
    })
    expect(rows(env.db)).toHaveLength(0)
  })

  it('匹配抛错时回滚临时行；没有剧集库给明确提示', async () => {
    env = setup({})
    const boom = new PlaceholderSeries({
      db: env.db,
      match: async () => {
        throw new Error('TMDB 超时')
      },
    })
    await expect(boom.ensure({ title: '甲' })).rejects.toThrow('TMDB 超时')
    expect(rows(env.db)).toHaveLength(0)
    env.cleanup()
    env = setup({}, [], false)
    await expect(env.placeholder.ensure({ title: '甲' })).rejects.toThrow(
      LibraryError
    )
  })

  it('不上海报墙；真实条目出现后由真实条目代表，版本成员不含占位', async () => {
    env = setup({ 小城良方: '1001' })
    const made = await env.placeholder.ensure({ title: '小城良方' })
    const query = new CatalogQuery(env.db)
    const wall = (): number[] =>
      query.list(normalizeLibraryQuery({})).items.map(item => item.id)
    expect(wall()).toEqual([])
    const placeholderId = made.status === 'ready' ? made.itemId : 0
    const real = Number(
      env.db
        .prepare(
          `INSERT INTO media_items (library_id, type, local_key, title, tmdb_id,
             match_state, added_at, updated_at)
           VALUES (?, 'series', 'k:real', '小城良方', '1001', 'auto', 1, 1) RETURNING id`
        )
        .get(env.libraryId)!.id
    )
    expect(wall()).toEqual([real])
    const members = new MergeStore(env.db)
    expect(members.membersOf(real)).toEqual([real])
    expect(members.membersOf(placeholderId)).toEqual([placeholderId, real])
  })

  it('真实条目 id 更小时，仍以占位为准（追更记在占位 id 上）；日历里这部剧只算一次', async () => {
    env = setup({ 小城良方: '1001' })
    const real = Number(
      env.db
        .prepare(
          `INSERT INTO media_items (library_id, type, local_key, title,
             match_state, added_at, updated_at)
           VALUES (?, 'series', 'k:real', '小城良方', 'review', 1, 1) RETURNING id`
        )
        .get(env.libraryId)!.id
    )
    const made = await env.placeholder.ensure({ title: '小城良方' })
    // 用户之后确认了真实条目的匹配，它的 id 比占位小
    env.db
      .prepare(
        `UPDATE media_items SET tmdb_id = '1001', match_state = 'auto' WHERE id = ?`
      )
      .run(real)
    const again = await env.placeholder.ensure({ title: '小城良方' })
    expect(made).toMatchObject({ status: 'ready', created: true })
    if (made.status === 'ready' && again.status === 'ready') {
      expect(made.itemId).toBeGreaterThan(real)
      expect(again.itemId).toBe(made.itemId)
    }
    const calendar = new CalendarModule({
      db: env.db,
      provider: () => ({ configured: false }) as unknown as CalendarProvider,
    })
    const result = await calendar.episodes({
      from: '2026-11-01',
      to: '2026-11-07',
    })
    expect(result.series).toBe(1)
  })

  it('临时行建出来就是锁定的：匹配期间不会被回收或被识别任务拾取', async () => {
    env = setup({})
    let during: unknown
    const probe = new PlaceholderSeries({
      db: env.db,
      match: async request => {
        during = env!.db
          .prepare('SELECT match_state FROM media_items WHERE id = ?')
          .get(request.itemId)
        return { status: 'unmatched', item: null, candidates: [] }
      },
    })
    await probe.ensure({ title: '甲' })
    expect(during).toEqual({ match_state: 'locked' })
  })

  it('只有混合库（kind 为 movie、mixed）时也能建：混合库里放剧', async () => {
    env = setup({ 小城良方: '1001' }, [], false)
    const tree = tempTree()
    const mixed = new LibraryStore(env.db).add(
      { root: tree.root, kind: 'movie', mixed: true },
      1
    ).id
    const result = await env.placeholder.ensure({ title: '小城良方' })
    expect(result).toMatchObject({ status: 'ready', created: true })
    expect(env.db.prepare('SELECT library_id FROM media_items').get()).toEqual({
      library_id: mixed,
    })
    tree.cleanup()
  })
})
