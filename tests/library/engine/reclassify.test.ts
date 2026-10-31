import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { reclassifyItem } from '../../../src/main/library/catalog/reclassify'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import { scanEnv, tempTree } from './helpers'

describe('混合库手动纠正', () => {
  let tree: ReturnType<typeof tempTree>
  beforeEach(() => {
    tree = tempTree()
  })
  afterEach(() => tree.cleanup())

  it('将误判的剧集改为电影，保留进度并在重扫后保持分类', async () => {
    const path = '电影/流浪地球 2.mkv'
    tree.write(path, 'fake')
    const env = scanEnv(tree.root, 'movie', true)
    await env.scan()
    const series = env.query.list(normalizeLibraryQuery({ types: ['series'] }))
      .items[0]
    const row = env.db.prepare('SELECT item_id, file_id FROM file_media').get()!
    env.db
      .prepare(
        'INSERT INTO watch_progress (item_id, file_id, position, duration, updated_at) VALUES (?, ?, 25, 100, 1)'
      )
      .run(Number(row.item_id), Number(row.file_id))
    reclassifyItem(env.db, env.catalog, env.library, series.id, 'movie')
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    expect(movie.title).toBe('流浪地球 2')
    expect(
      JSON.parse(
        String(env.db.prepare('SELECT parsed FROM files').get()?.parsed)
      )
    ).toMatchObject({ type: 'movie', title: '流浪地球 2' })
    expect(
      env.db
        .prepare('SELECT position FROM watch_progress WHERE item_id = ?')
        .get(movie.id)
    ).toEqual({ position: 25 })
    tree.write(path, 'changed')
    await env.scan({ full: true })
    expect(
      env.query.list(normalizeLibraryQuery({ types: ['movie'] })).items[0].id
    ).toBe(movie.id)
    expect(
      env.query.list(normalizeLibraryQuery({ types: ['series'] })).total
    ).toBe(0)
    env.db.close()
  })

  it('将电影改为剧集后保留进度并创建可播放的季和集', async () => {
    tree.write('节目/节目.mkv', 'fake')
    const env = scanEnv(tree.root, 'movie', true)
    await env.scan()
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    const file = env.db.prepare('SELECT id FROM files').get()!
    env.db
      .prepare(
        'INSERT INTO watch_progress (item_id, file_id, position, duration, updated_at) VALUES (?, ?, 33, 100, 1)'
      )
      .run(movie.id, Number(file.id))
    reclassifyItem(env.db, env.catalog, env.library, movie.id, 'tv')
    const node = env.query.getItem(movie.id)!
    expect(node.type).toBe('series')
    const episode = node.children[0].children[0]
    expect(episode.files).toHaveLength(1)
    expect(
      env.db
        .prepare('SELECT position FROM watch_progress WHERE item_id = ?')
        .get(episode.id)
    ).toEqual({ position: 33 })
    expect(
      JSON.parse(
        String(env.db.prepare('SELECT parsed FROM files').get()?.parsed)
      )
    ).toMatchObject({ type: 'episode' })
    env.db.close()
  })

  it('多集剧纠正为电影后文件仍归属于同一条目', async () => {
    tree.write('剧集/节目/节目.S01E01.mkv', 'one')
    tree.write('剧集/节目/节目.S01E02.mkv', 'two')
    const env = scanEnv(tree.root, 'movie', true)
    await env.scan()
    const series = env.query.list(normalizeLibraryQuery({ types: ['series'] }))
      .items[0]
    reclassifyItem(env.db, env.catalog, env.library, series.id, 'movie')
    expect(env.query.getItem(series.id)?.type).toBe('movie')
    expect(env.query.getItem(series.id)?.files).toHaveLength(2)
    env.db.close()
  })

  it('多文件电影纠正为剧集后保留各集和观看进度', async () => {
    tree.write('节目/节目.S01E01.mkv', 'first')
    tree.write('节目/节目.S01E02.mkv', 'second')
    const env = scanEnv(tree.root, 'movie', true)
    env.library.mixed = false
    await env.scan()
    env.library.mixed = true
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    const file = env.db
      .prepare("SELECT id FROM files WHERE name LIKE '%E02%'")
      .get()!
    env.db
      .prepare(
        'INSERT INTO watch_progress (item_id, file_id, position, duration, updated_at) VALUES (?, ?, 33, 100, 1)'
      )
      .run(movie.id, Number(file.id))
    reclassifyItem(env.db, env.catalog, env.library, movie.id, 'tv')
    const episodes = env.query.getItem(movie.id)!.children[0].children
    expect(episodes.map(ep => ep.episodeNumber)).toEqual([1, 2])
    expect(
      env.db
        .prepare('SELECT position FROM watch_progress WHERE item_id = ?')
        .get(episodes[1].id)
    ).toEqual({ position: 33 })
    env.db.close()
  })

  it('多集进度在剧集转电影并转回后按文件保留', async () => {
    tree.write('节目/节目.S01E01.mkv', 'first')
    tree.write('节目/节目.S01E02.mkv', 'second')
    const env = scanEnv(tree.root, 'movie', true)
    await env.scan()
    const series = env.query.list(normalizeLibraryQuery({ types: ['series'] }))
      .items[0]
    const rows = env.db
      .prepare('SELECT item_id, file_id FROM file_media ORDER BY file_id')
      .all()
    for (const [index, row] of rows.entries())
      env.db
        .prepare(
          'INSERT INTO watch_progress (item_id, file_id, position, duration, updated_at) VALUES (?, ?, ?, 100, ?)'
        )
        .run(
          Number(row.item_id),
          Number(row.file_id),
          (index + 1) * 20,
          index + 1
        )
    reclassifyItem(env.db, env.catalog, env.library, series.id, 'movie')
    expect(
      env.db.prepare('SELECT count(*) AS n FROM reclassify_progress').get()
    ).toEqual({ n: 2 })
    expect(
      env.db
        .prepare('SELECT position FROM watch_progress WHERE item_id = ?')
        .get(series.id)
    ).toEqual({ position: 40 })
    reclassifyItem(env.db, env.catalog, env.library, series.id, 'tv')
    const restored = env.db
      .prepare('SELECT position FROM watch_progress ORDER BY position')
      .all()
    expect(restored).toEqual([{ position: 20 }, { position: 40 }])
    env.db.close()
  })

  it('纠正为剧集时保留文件名中的季和集', async () => {
    tree.write('节目/节目.S02E03.mkv', 'fake')
    const env = scanEnv(tree.root, 'movie', true)
    env.library.mixed = false
    await env.scan()
    env.library.mixed = true
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    reclassifyItem(env.db, env.catalog, env.library, movie.id, 'tv')
    const season = env.query.getItem(movie.id)!.children[0]
    expect(season.seasonNumber).toBe(2)
    expect(season.children[0].episodeNumber).toBe(3)
    env.db.close()
  })

  it('动漫绝对集数纠正为剧集后不伪造季号', async () => {
    tree.write('One Piece/[Sub] One Piece - 1071 [1080p].mkv', 'fake')
    const env = scanEnv(tree.root, 'movie', true)
    env.library.mixed = false
    await env.scan()
    env.library.mixed = true
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    reclassifyItem(env.db, env.catalog, env.library, movie.id, 'tv')
    const episode = env.query.getItem(movie.id)!.children[0]
    expect(episode.seasonNumber).toBeNull()
    expect(episode.episodeNumber).toBe(1071)
    env.db.close()
  })

  it('无集号文件纠正时保留作品名和所在季', async () => {
    tree.write('某剧/Season 2/第一章.mkv', 'fake')
    const env = scanEnv(tree.root, 'movie', true)
    env.library.mixed = false
    await env.scan()
    env.library.mixed = true
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    reclassifyItem(env.db, env.catalog, env.library, movie.id, 'tv')
    const node = env.query.getItem(movie.id)!
    expect(node.title).toBe('某剧')
    expect(node.children[0].seasonNumber).toBe(2)
    env.db.close()
  })

  it('纠正剧集后新增同剧文件归到同一部和同一季', async () => {
    tree.write('节目/节目.S01E01.mkv', 'first')
    const env = scanEnv(tree.root, 'movie', true)
    env.library.mixed = false
    await env.scan()
    env.library.mixed = true
    const movie = env.query.list(normalizeLibraryQuery({ types: ['movie'] }))
      .items[0]
    reclassifyItem(env.db, env.catalog, env.library, movie.id, 'tv')
    tree.write('节目/节目.S01E02.mkv', 'second')
    await env.scan({ full: true })
    expect(
      env.query.list(normalizeLibraryQuery({ types: ['series'] })).total
    ).toBe(1)
    const node = env.query.getItem(movie.id)!
    expect(node.children).toHaveLength(1)
    expect(node.children[0].children).toHaveLength(2)
    env.db.close()
  })

  it('纠正为电影后移动文件仍以电影解析', async () => {
    const from = tree.write('原目录/影片.S01E01.mkv', 'fake')
    const env = scanEnv(tree.root, 'movie', true)
    await env.scan()
    const series = env.query.list(normalizeLibraryQuery({ types: ['series'] }))
      .items[0]
    reclassifyItem(env.db, env.catalog, env.library, series.id, 'movie')
    const targetDir = join(tree.root, '新目录')
    mkdirSync(targetDir, { recursive: true })
    renameSync(from, join(targetDir, '影片.S01E01.mkv'))
    const result = await env.scan({ full: true })
    expect(result.moved).toHaveLength(1)
    expect(
      JSON.parse(
        String(env.db.prepare('SELECT parsed FROM files').get()?.parsed)
      )
    ).toMatchObject({ type: 'movie' })
    env.db.close()
  })
})
