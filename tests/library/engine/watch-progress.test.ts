/**
 * 观看进度：合并规则（看完阈值、重看保留看完、手动标记）、后写胜出、跨库键，
 * 以及引擎里的进度表（按条目树查、海报墙概况、最近观看、导出 / 导入、RPC 参数校验）。
 */
import { describe, expect, it } from 'vitest'

import { parseRpcParams } from '../../../src/shared/library/ipc'
import {
  WATCHED_RATIO,
  applyReport,
  incomingWins,
  progressSyncKey,
} from '../../../src/shared/library/watch-progress'
import { openLibraryDb } from '../../../src/main/library/db/database'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import type { LibraryService } from '../../../src/main/library/engine/service'
import { ProgressStore } from '../../../src/main/library/progress/progress-store'

describe('合并规则', () => {
  it('过了 90% 算看完，从头重看仍保留看完', () => {
    expect(WATCHED_RATIO).toBe(0.9)
    const a = applyReport(null, { itemId: 1, position: 89, duration: 100 }, 1)
    expect(a.watched).toBe(false)
    const b = applyReport(a, { itemId: 1, position: 90, duration: 100 }, 2)
    expect(b).toMatchObject({ watched: true, position: 90, updatedAt: 2 })
    const c = applyReport(b, { itemId: 1, position: 12, duration: 0 }, 3)
    expect(c).toMatchObject({ watched: true, position: 12, duration: 100 })
  })

  it('播到结尾算看完；手动标成未看清零位置', () => {
    const ended = applyReport(
      null,
      { itemId: 1, position: 10, duration: 0, ended: true },
      1
    )
    expect(ended.watched).toBe(true)
    const unwatched = applyReport(
      ended,
      { itemId: 1, position: 50, duration: 100, watched: false },
      2
    )
    expect(unwatched).toMatchObject({ watched: false, position: 0 })
  })

  it('后写胜出，同一时间看 preferIncoming', () => {
    expect(incomingWins(null, { updatedAt: 1 })).toBe(true)
    expect(incomingWins({ updatedAt: 2 }, { updatedAt: 1 })).toBe(false)
    expect(incomingWins({ updatedAt: 1 }, { updatedAt: 2 })).toBe(true)
    expect(incomingWins({ updatedAt: 2 }, { updatedAt: 2 })).toBe(false)
    expect(incomingWins({ updatedAt: 2 }, { updatedAt: 2 }, true)).toBe(true)
  })

  it('跨库键：电影 / 集按 TMDB，没有时按文件指纹', () => {
    const base = {
      tmdbId: null,
      season: null,
      episode: null,
      fingerprint: null,
    }
    expect(progressSyncKey({ ...base, type: 'movie', tmdbId: '603' })).toBe(
      'movie:603'
    )
    expect(
      progressSyncKey({
        ...base,
        type: 'episode',
        tmdbId: '95396',
        season: 1,
        episode: 2,
      })
    ).toBe('tv:95396:1:2')
    expect(
      progressSyncKey({ ...base, type: 'episode', fingerprint: 'ab' })
    ).toBe('fp:ab')
    expect(progressSyncKey({ ...base, type: 'movie' })).toBeNull()
  })
})

/** 一个最小片库：一部电影、一部两集的剧（各有文件），返回 id。 */
interface Seeded {
  db: ReturnType<typeof openLibraryDb>
  movie: number
  series: number
  season: number
  ep1: number
  ep2: number
  files: { movie: number; ep1: number; ep2: number }
}

function seed(tmdb = { movie: '603', series: '95396' }): Seeded {
  const db = openLibraryDb(':memory:')
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
       season_number, episode_number, tmdb_id, match_state, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto', 1, 1) RETURNING id`
  )
  const add = (...args: Array<string | number | null>): number =>
    Number(insert.get(...args)!.id)
  let n = 0
  const file = (libraryId: number, itemId: number): number => {
    n++
    const id = Number(
      db
        .prepare(
          `INSERT INTO files (library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at, fingerprint)
           VALUES (?, ?, ?, '/', ?, 'video', 1, 1, 1, 1, ?) RETURNING id`
        )
        .get(libraryId, `/f${n}.mkv`, `/f${n}.mkv`, `f${n}.mkv`, `fp${n}`)!.id
    )
    db.prepare('INSERT INTO file_media (file_id, item_id) VALUES (?, ?)').run(
      id,
      itemId
    )
    return id
  }
  const movie = add(
    movies,
    'movie',
    null,
    'm',
    'Matrix',
    null,
    null,
    tmdb.movie
  )
  const series = add(
    tv,
    'series',
    null,
    's',
    'Severance',
    null,
    null,
    tmdb.series
  )
  const season = add(tv, 'season', series, 's1', 'S1', 1, null, null)
  const ep1 = add(tv, 'episode', season, 's1e1', 'E1', 1, 1, null)
  const ep2 = add(tv, 'episode', season, 's1e2', 'E2', 1, 2, null)
  const files = {
    movie: file(movies, movie),
    ep1: file(tv, ep1),
    ep2: file(tv, ep2),
  }
  return { db, movie, series, season, ep1, ep2, files }
}

describe('进度表', () => {
  it('上报只认电影和集，按条目树查', () => {
    const { db, movie, series, season, ep1, files } = seed()
    const store = new ProgressStore(db)
    const saved = store.save(
      [
        { itemId: ep1, fileId: files.ep1, position: 30, duration: 100 },
        { itemId: season, position: 1, duration: 1 },
        { itemId: 9999, position: 1, duration: 1 },
      ],
      10
    )
    expect(saved.map(p => p.itemId)).toEqual([ep1])
    expect(store.list([series])).toEqual([
      {
        itemId: ep1,
        fileId: files.ep1,
        position: 30,
        duration: 100,
        watched: false,
        updatedAt: 10,
      },
    ])
    expect(store.list([movie])).toEqual([])
  })

  it('海报墙概况：电影按位置，剧按看完的集数；最近观看每个顶层条目一条', () => {
    const { db, movie, series, ep1, ep2 } = seed()
    const store = new ProgressStore(db)
    store.save([{ itemId: movie, position: 50, duration: 200 }], 1)
    store.save([{ itemId: ep1, position: 95, duration: 100 }], 2)
    const summary = store.summary([movie, series])
    expect(summary).toEqual(
      expect.arrayContaining([
        { itemId: movie, watched: false, ratio: 0.25, updatedAt: 1 },
        { itemId: series, watched: false, ratio: 0.5, updatedAt: 2 },
      ])
    )
    store.save([{ itemId: ep2, position: 3, duration: 100, ended: true }], 3)
    expect(store.summary([series])[0]).toMatchObject({
      watched: true,
      ratio: 1,
    })
    expect(store.recent().map(r => [r.rootId, r.itemId])).toEqual([
      [series, ep2],
      [movie, movie],
    ])
  })

  it('导出 / 导入：两个库的条目 id 不同，按跨库键对上，后写胜出', () => {
    const desktop = seed()
    const server = seed()
    // 让两边的 id 错开：服务端多一个占位条目不影响按键匹配
    const local = new ProgressStore(desktop.db)
    const remote = new ProgressStore(server.db)
    local.save([{ itemId: desktop.ep1, position: 40, duration: 100 }], 100)
    remote.save([{ itemId: server.ep1, position: 70, duration: 100 }], 200)
    remote.save([{ itemId: server.movie, position: 10, duration: 100 }], 50)

    const pulled = local.import(remote.export(), true)
    expect(pulled.applied).toBe(2)
    expect(local.get(desktop.ep1)).toMatchObject({
      position: 70,
      updatedAt: 200,
      fileId: desktop.files.ep1,
    })
    // 本地旧的不覆盖服务端新的
    const pushed = remote.import(local.export(150))
    expect(pushed.applied).toBe(0)
    expect(local.export(150).map(e => e.key)).toEqual(['tv:95396:1:1'])
  })

  it('对不上 TMDB 时按文件指纹；都对不上的跳过', () => {
    const a = seed({ movie: '', series: '' })
    const store = new ProgressStore(a.db)
    store.save([{ itemId: a.movie, position: 5, duration: 10 }], 1)
    expect(store.export().map(e => e.key)).toEqual(['fp:fp1'])
    const result = store.import([
      {
        key: 'movie:1',
        position: 1,
        duration: 2,
        watched: false,
        updatedAt: 9,
      },
    ])
    expect(result).toMatchObject({ applied: 0, unmatched: 1 })
  })

  it('条目删掉时进度级联删除', () => {
    const { db, movie } = seed()
    const store = new ProgressStore(db)
    store.save([{ itemId: movie, position: 5, duration: 10 }], 1)
    db.prepare('DELETE FROM media_items WHERE id = ?').run(movie)
    expect(store.get(movie)).toBeNull()
  })
})

describe('RPC', () => {
  it('参数校验：坏的上报 / 导入条目拒绝', () => {
    expect(() =>
      parseRpcParams('progress.save', {
        reports: [{ itemId: 1, position: -1, duration: 1 }],
      })
    ).toThrow()
    expect(() =>
      parseRpcParams('progress.import', {
        entries: [
          { key: 'bad', position: 1, duration: 1, watched: true, updatedAt: 1 },
        ],
      })
    ).toThrow()
    expect(parseRpcParams('progress.recent', { limit: 999 })).toEqual({
      limit: 200,
    })
  })

  it('handleRpc 走同一张进度表（桌面端与片库服务共用）', async () => {
    const { db, movie } = seed()
    const service = { db } as unknown as LibraryService
    const saved = await handleRpc(service, {
      method: 'progress.save',
      params: { reports: [{ itemId: movie, position: 95, duration: 100 }] },
    })
    expect(saved).toMatchObject({ ok: true })
    const listed = await handleRpc(service, {
      method: 'progress.list',
      params: { itemIds: [movie] },
    })
    expect(listed).toMatchObject({
      ok: true,
      result: [{ itemId: movie, watched: true }],
    })
  })
})
