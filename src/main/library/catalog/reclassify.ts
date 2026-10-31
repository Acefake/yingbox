/** 混合库条目的类型纠正。 */
import { LibraryError, type LibraryKind } from '../../../shared/library/ipc'
import { parseMediaPath } from '../../../shared/library/parser'
import { normalizeTitle } from '../../../shared/library/scoring'
import { type LibraryDb, transaction } from '../db/database'
import type { LibraryRecord } from '../libraries/library-store'
import type { CatalogStore } from './catalog-store'
import { groupFile } from './grouping'

/** 原地纠正条目，保留条目 ID 和可确定归属的观看进度。 */
export function reclassifyItem(
  db: LibraryDb,
  catalog: CatalogStore,
  library: LibraryRecord,
  itemId: number,
  kind: LibraryKind
): void {
  if (!library.mixed || library.source === 'jav')
    throw new LibraryError('conflict', '只有混合库可以纠正类型')
  transaction(db, () => {
    const root = db
      .prepare(
        "SELECT id, type, local_key FROM media_items WHERE id = ? AND library_id = ? AND parent_id IS NULL AND type IN ('movie','series')"
      )
      .get(itemId, library.id)
    if (!root) throw new LibraryError('not-found', '条目不存在')
    if ((root.type === 'movie' ? 'movie' : 'tv') === kind) return
    const treeSql =
      'WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT m.id FROM media_items m JOIN tree t ON m.parent_id = t.id)'
    const files = db
      .prepare(
        `${treeSql} SELECT DISTINCT f.id, f.path, f.display_path FROM files f JOIN file_media fm ON fm.file_id = f.id WHERE fm.item_id IN (SELECT id FROM tree) AND f.kind = 'video'`
      )
      .all(itemId)
    if (!files.length)
      throw new LibraryError('conflict', '条目没有视频文件，无法纠正')
    const fileId = Number(files[0].id)
    const shared = db
      .prepare(
        `${treeSql} SELECT COUNT(*) AS n FROM file_media WHERE file_id = ? AND item_id NOT IN (SELECT id FROM tree)`
      )
      .get(itemId, fileId)
    if (Number(shared?.n))
      throw new LibraryError('conflict', '该文件还属于其他条目，无法自动纠正')
    for (const file of files.slice(1)) {
      if (
        Number(
          db
            .prepare(
              `${treeSql} SELECT COUNT(*) AS n FROM file_media WHERE file_id = ? AND item_id NOT IN (SELECT id FROM tree)`
            )
            .get(itemId, Number(file.id))?.n
        )
      )
        throw new LibraryError('conflict', '该文件还属于其他条目，无法自动纠正')
    }
    const progress = db
      .prepare(
        `${treeSql} SELECT item_id, file_id, position, duration, watched, updated_at FROM watch_progress WHERE item_id IN (SELECT id FROM tree)`
      )
      .all(itemId)
    const fileIds = new Set(files.map(file => Number(file.id)))
    const progressByFile = new Map<number, (typeof progress)[number]>()
    const saved = db
      .prepare(
        'SELECT file_id, position, duration, watched, updated_at FROM reclassify_progress WHERE item_id = ?'
      )
      .all(itemId)
    for (const row of [...saved, ...progress]) {
      let id = row.file_id == null ? null : Number(row.file_id)
      if (id === null && row.item_id != null) {
        const linked = db
          .prepare('SELECT file_id FROM file_media WHERE item_id = ?')
          .all(Number(row.item_id))
        if (linked.length !== 1)
          throw new LibraryError('conflict', '无法确定播放进度所属文件')
        id = Number(linked[0].file_id)
      }
      if (id === null || !fileIds.has(id)) {
        if (row.item_id != null)
          throw new LibraryError(
            'conflict',
            '播放进度关联了其他文件，无法自动纠正'
          )
        continue
      }
      const previous = progressByFile.get(id)
      if (!previous || Number(previous.updated_at) <= Number(row.updated_at))
        progressByFile.set(id, row)
    }
    const relativeKey = String(files[0].path).slice(library.rootKey.length + 1)
    const relativePath = String(files[0].display_path)
      .split(/[\\/]+/)
      .slice(-relativeKey.split('/').length)
      .join('/')
    let parsed = parseMediaPath(relativePath, {
      forceMovie: kind === 'movie',
      inferUnnumberedSeason: kind === 'tv',
    })
    if (kind === 'tv' && parsed.type === 'movie') {
      parsed = { ...parsed, type: 'episode', season: 1, episodes: [] }
    }
    if (parsed.type === 'extra')
      throw new LibraryError('conflict', '附加内容不能纠正为正片')
    if (parsed.type === 'episode' && parsed.episodes.length > 1)
      throw new LibraryError('conflict', '单个文件包含多集，无法自动纠正')
    if (!parsed.title)
      throw new LibraryError('conflict', '无法解析文件名，请先重命名文件')
    const title = parsed.title
    const normalized = normalizeTitle(title)
    const grouping = groupFile(
      { libraryId: library.id, kind, relativeKey },
      parsed
    )
    const rootSeed = grouping.ancestors[0] ?? grouping.leaves[0]
    if (!rootSeed) throw new LibraryError('conflict', '无法确定条目归属')
    const collision = db
      .prepare('SELECT id FROM media_items WHERE local_key = ? AND id <> ?')
      .get(rootSeed.localKey, itemId)
    if (collision)
      throw new LibraryError('conflict', '目标作品已存在，请先处理重复条目')
    const extraFiles = files.slice(1).map(file => {
      const key = String(file.path).slice(library.rootKey.length + 1)
      const path = String(file.display_path)
        .split(/[\\/]+/)
        .slice(-key.split('/').length)
        .join('/')
      let candidate = parseMediaPath(path, {
        forceMovie: kind === 'movie',
        inferUnnumberedSeason: kind === 'tv',
      })
      if (kind === 'tv' && candidate.type === 'movie')
        candidate = { ...candidate, type: 'episode', season: 1, episodes: [] }
      const other = groupFile(
        { libraryId: library.id, kind, relativeKey: key },
        candidate
      )
      if (
        candidate.type === 'extra' ||
        (candidate.type === 'episode' && candidate.episodes.length > 1) ||
        (other.ancestors[0] ?? other.leaves[0])?.localKey !== rootSeed.localKey
      )
        throw new LibraryError('conflict', '文件可能属于不同作品，无法自动纠正')
      return { id: Number(file.id), parsed: candidate, grouping: other }
    })
    db.prepare(
      `${treeSql} DELETE FROM file_media WHERE item_id IN (SELECT id FROM tree)`
    ).run(itemId)
    db.prepare(
      `${treeSql} DELETE FROM watch_progress WHERE item_id IN (SELECT id FROM tree)`
    ).run(itemId)
    db.prepare('DELETE FROM media_items WHERE parent_id = ?').run(itemId)
    db.prepare('DELETE FROM matches WHERE item_id = ?').run(itemId)
    db.prepare('DELETE FROM item_actors WHERE item_id = ?').run(itemId)
    db.prepare(
      `UPDATE media_items SET type = ?, local_key = ?, title = ?, original_title = ?, sort_title = ?, search_text = ?, year = ?, tmdb_id = NULL, imdb_id = NULL, tvdb_id = NULL, match_state = 'unmatched', overview = NULL, poster = NULL, backdrop = NULL, logo = NULL, rating = NULL, rating_source = NULL, runtime = NULL, genres = NULL, air_date = NULL, metadata = NULL, metadata_at = NULL, merge_split = NULL, updated_at = ? WHERE id = ?`
    ).run(
      kind === 'movie' ? 'movie' : 'series',
      rootSeed.localKey,
      title,
      parsed.altTitle ?? null,
      normalized,
      normalized,
      parsed.year ?? null,
      Date.now(),
      itemId
    )
    const leaves = new Map<number, number>()
    for (const file of [{ id: fileId, parsed, grouping }, ...extraFiles]) {
      let leaf = itemId
      if (kind === 'tv') {
        const seasonSeed = file.grouping.ancestors.find(
          seed => seed.type === 'season'
        )
        let parentId = itemId
        if (seasonSeed) {
          db.prepare(
            "INSERT OR IGNORE INTO media_items (library_id, type, parent_id, local_key, season_number, added_at, updated_at) VALUES (?, 'season', ?, ?, ?, ?, ?)"
          ).run(
            library.id,
            itemId,
            seasonSeed.localKey,
            seasonSeed.seasonNumber,
            Date.now(),
            Date.now()
          )
          parentId = Number(
            db
              .prepare('SELECT id FROM media_items WHERE local_key = ?')
              .get(seasonSeed.localKey)!.id
          )
        }
        const ep = file.grouping.leaves[0]
        if (!ep) throw new LibraryError('conflict', '无法确定剧集归属')
        const airDate =
          file.parsed.type === 'episode' ? (file.parsed.airDate ?? null) : null
        db.prepare(
          "INSERT OR IGNORE INTO media_items (library_id, type, parent_id, local_key, season_number, episode_number, air_date, added_at, updated_at) VALUES (?, 'episode', ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          library.id,
          parentId,
          ep.localKey,
          ep.seasonNumber,
          ep.episodeNumber,
          airDate,
          Date.now(),
          Date.now()
        )
        leaf = Number(
          db
            .prepare('SELECT id FROM media_items WHERE local_key = ?')
            .get(ep.localKey)!.id
        )
      }
      db.prepare(
        'INSERT OR IGNORE INTO file_media (file_id, item_id) VALUES (?, ?)'
      ).run(file.id, leaf)
      db.prepare(
        'UPDATE files SET media_kind_override = ?, parsed = ? WHERE id = ?'
      ).run(kind, JSON.stringify(file.parsed), file.id)
      leaves.set(file.id, leaf)
    }
    const progressByLeaf = new Map<
      number,
      { fileId: number; row: (typeof progress)[number] }
    >()
    for (const [id, p] of progressByFile) {
      db.prepare(
        `INSERT INTO reclassify_progress (item_id, file_id, position, duration, watched, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(item_id, file_id) DO UPDATE SET
        position = excluded.position, duration = excluded.duration, watched = excluded.watched,
        updated_at = excluded.updated_at WHERE excluded.updated_at >= reclassify_progress.updated_at`
      ).run(
        itemId,
        id,
        Number(p.position),
        Number(p.duration),
        Number(p.watched),
        Number(p.updated_at)
      )
      const destination = leaves.get(id)!
      const existing = progressByLeaf.get(destination)
      if (!existing || Number(existing.row.updated_at) < Number(p.updated_at))
        progressByLeaf.set(destination, { fileId: id, row: p })
    }
    for (const [
      destination,
      { fileId: progressFileId, row: p },
    ] of progressByLeaf) {
      db.prepare(
        'INSERT INTO watch_progress (item_id, file_id, position, duration, watched, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        destination,
        progressFileId,
        Number(p.position),
        Number(p.duration),
        Number(p.watched),
        Number(p.updated_at)
      )
    }
  })
  catalog.clearCache()
}
