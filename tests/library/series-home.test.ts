/**
 * 剧的「家」：同一部剧的视频分散在几个文件夹时，视频最多的剧文件夹是家，季文件夹按季取。
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { pickSeriesHome } from '../../src/main/library/catalog/series-home-rules'
import { SeriesHomeQuery } from '../../src/main/library/catalog/series-home'
import {
  type LibraryDb,
  openLibraryDb,
} from '../../src/main/library/db/database'

const root = join('E:', '影音库')
const at = (...parts: string[]): string => join(root, ...parts)

describe('pickSeriesHome', () => {
  it('视频最多的剧文件夹是家，季文件夹取这一季视频所在的文件夹', () => {
    const home = at('剧集', '大陆', '嫁金釵 (2026)(1)')
    const files = [
      ...[1, 2, 3].map(e => ({
        path: join(home, 'Season 01', `x.S01E0${e}.mkv`),
        season: 1,
      })),
      // 散在根目录另建的同名文件夹里的两集
      { path: at('嫁金釵 (2026)', 'Season 01', 'x.S01E22.mkv'), season: 1 },
      { path: at('嫁金釵 (2026)', 'Season 01', 'x.S01E23.mkv'), season: 1 },
      // 直接放在根目录的一集不算任何剧文件夹
      { path: at('嫁金钗.S01E24.mkv'), season: 1 },
    ]
    expect(pickSeriesHome(root, files)).toEqual({
      dir: home,
      seasons: { 1: join(home, 'Season 01') },
    })
  })

  it('集直接放在剧文件夹里时，没有季文件夹', () => {
    const home = at('剧集', '交锋 (2026)')
    expect(
      pickSeriesHome(root, [{ path: join(home, '交锋.S01E01.mkv'), season: 1 }])
    ).toEqual({ dir: home, seasons: {} })
  })

  it('只有根目录下的散放文件时没有家', () => {
    expect(
      pickSeriesHome(root, [{ path: at('嫁金钗.S01E24.mkv'), season: 1 }])
    ).toBeNull()
    expect(pickSeriesHome(root, [])).toBeNull()
  })

  it('不在媒体库根目录下的路径忽略', () => {
    expect(
      pickSeriesHome(root, [
        { path: join('F:', '别处', '剧', 'x.S01E01.mkv'), season: 1 },
      ])
    ).toBeNull()
  })
})

describe('SeriesHomeQuery', () => {
  /** 一个剧集库：散在根目录的新条目与剧文件夹里的老条目同 TMDB id。 */
  function seed(): { db: LibraryDb; loose: number; libraryId: number } {
    const db = openLibraryDb(':memory:')
    const libraryId = Number(
      db
        .prepare(
          `INSERT INTO libraries (root, root_display, kind, name, created_at)
           VALUES (?, ?, 'tv', '剧集', 1) RETURNING id`
        )
        .get(root.toLowerCase(), root)!.id
    )
    const add = db.prepare(
      `INSERT INTO media_items (library_id, type, parent_id, local_key, title,
        season_number, episode_number, tmdb_id, match_state, added_at, updated_at)
       VALUES (?, ?, ?, ?, '嫁金釵', ?, ?, ?, 'auto', 1, 1) RETURNING id`
    )
    const file = db.prepare(
      `INSERT INTO files (library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at)
       VALUES (?, ?, ?, '', '', 'video', 1, 1, 1, 1) RETURNING id`
    )
    const link = db.prepare(
      'INSERT INTO file_media (file_id, item_id) VALUES (?, ?)'
    )
    const series = (key: string, paths: string[]): number => {
      const id = Number(
        add.get(libraryId, 'series', null, key, null, null, '300146')!.id
      )
      const season = Number(
        add.get(libraryId, 'season', id, `${key}:s1`, 1, null, null)!.id
      )
      paths.forEach((path, i) => {
        const ep = Number(
          add.get(libraryId, 'episode', season, `${key}:e${i}`, 1, i + 1, null)!
            .id
        )
        link.run(Number(file.get(libraryId, path.toLowerCase(), path)!.id), ep)
      })
      return id
    }
    const home = at('剧集', '大陆', '嫁金釵 (2026)(1)', 'Season 01')
    series('old', [join(home, 'a.S01E01.mkv'), join(home, 'a.S01E02.mkv')])
    const loose = series('new', [at('嫁金钗.S01E24.mkv')])
    return { db, loose, libraryId }
  }

  it('从散放的新条目找到同 TMDB id 老条目的剧文件夹', () => {
    const { db, loose, libraryId } = seed()
    const home = at('剧集', '大陆', '嫁金釵 (2026)(1)')
    expect(new SeriesHomeQuery(db).homeOf(loose)).toEqual({
      dir: home,
      seasons: { 1: join(home, 'Season 01') },
      libraryId,
    })
    expect(new SeriesHomeQuery(db).homeOf(loose, libraryId + 1)).toBeNull()
  })
})
