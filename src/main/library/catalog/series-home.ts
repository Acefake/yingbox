/**
 * 剧的「家」（查库）：某部剧与它合并展示的同键条目（同 TMDB id、同来源）下的全部视频，交给 pickSeriesHome 选家。
 * 追更转存（RPC calendar.seriesFolder）跨媒体库找；整理只在条目自己的媒体库里找（ADR-0029）。
 */
import { sep } from 'node:path'

import { type LibraryDb, StatementCache } from '../db/database'
import {
  type SeriesHome,
  type SeriesVideo,
  pickSeriesHome,
} from './series-home-rules'

/** 条目自身加上同键、同来源的顶层条目。 */
const MEMBERS_SQL = `SELECT ?1 AS id UNION
  SELECT m.id FROM media_items i
  JOIN libraries li ON li.id = i.library_id
  JOIN media_items m ON m.merge_key = i.merge_key
  JOIN libraries lm ON lm.id = m.library_id AND lm.source = li.source
  WHERE i.id = ?1`

/** 这些剧下的视频（集挂在季下或直接挂在剧下），带季号和媒体库根目录。 */
const VIDEOS_SQL = `SELECT f.display_path AS path, l.id AS library_id, l.root_display AS root,
    COALESCE(e.season_number, s.season_number) AS season
  FROM media_items e
  LEFT JOIN media_items s ON s.id = e.parent_id AND s.type = 'season'
  JOIN file_media fm ON fm.item_id = e.id
  JOIN files f ON f.id = fm.file_id AND f.kind = 'video'
  JOIN libraries l ON l.id = e.library_id
  WHERE e.type = 'episode'
    AND (e.parent_id IN (SELECT value FROM json_each(?1))
      OR s.parent_id IN (SELECT value FROM json_each(?1)))`

/** 剧的家，连同它所在的媒体库。 */
export interface SeriesHomeAt extends SeriesHome {
  libraryId: number
}

/** 查剧的家。 */
export class SeriesHomeQuery {
  private readonly sql: StatementCache

  constructor(db: LibraryDb) {
    this.sql = new StatementCache(db)
  }

  /**
   * 这部剧的家；没有任何视频在剧文件夹里时为 null。
   * @param libraryId 只在这个媒体库里找；不传则在各库里取视频最多的那个家
   */
  homeOf(itemId: number, libraryId?: number): SeriesHomeAt | null {
    const members = this.sql
      .get(MEMBERS_SQL)
      .all(itemId)
      .map(r => Number(r.id))
    const byLibrary = new Map<number, { root: string; videos: SeriesVideo[] }>()
    for (const row of this.sql.get(VIDEOS_SQL).all(JSON.stringify(members))) {
      const id = Number(row.library_id)
      if (libraryId !== undefined && id !== libraryId) continue
      const entry = byLibrary.get(id) ?? { root: String(row.root), videos: [] }
      entry.videos.push({
        path: String(row.path),
        season: row.season === null ? null : Number(row.season),
      })
      byLibrary.set(id, entry)
    }
    let best: { home: SeriesHomeAt; count: number } | null = null
    for (const [id, { root, videos }] of byLibrary) {
      const home = pickSeriesHome(root, videos)
      if (!home) continue
      const count = videos.filter(v => v.path.startsWith(home.dir + sep)).length
      if (!best || count > best.count)
        best = { home: { ...home, libraryId: id }, count }
    }
    return best?.home ?? null
  }
}
