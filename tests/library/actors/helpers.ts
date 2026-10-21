/**
 * 演员库测试的公共工具：内存库里造番号库条目（带演员表元数据）、假的资料来源。
 */
import {
  type LibraryDb,
  openLibraryDb,
} from '../../../src/main/library/db/database'
import type {
  ActorProfile,
  ActorSource,
} from '../../../src/main/library/providers/jav/actors'
import type { LibrarySource } from '../../../src/shared/library/ipc'

/** 新建内存库与一个媒体库，返回库 id。 */
export function memoryDb(source: LibrarySource = 'jav'): {
  db: LibraryDb
  libraryId: number
} {
  const db = openLibraryDb(':memory:')
  const row = db
    .prepare(
      `INSERT INTO libraries (root, root_display, kind, name, created_at, source)
       VALUES (?, ?, 'movie', 'jav', 1, ?) RETURNING id`
    )
    .get(`/m-${source}`, `/m-${source}`, source)!
  return { db, libraryId: Number(row.id) }
}

let seq = 0

/** 造一个已识别的电影条目，cast 为演员名列表；返回条目 id。 */
export function addMovie(
  db: LibraryDb,
  libraryId: number,
  code: string,
  cast: string[],
  addedAt = 1
): number {
  const metadata = {
    level: 'title',
    ref: { provider: 'jav', kind: 'movie', id: code },
    title: code,
    genres: [],
    countries: [],
    companies: [],
    cast: cast.map((name, order) => ({ id: name, name, order })),
    crew: [],
    images: [],
    externalIds: {},
  }
  const row = db
    .prepare(
      `INSERT INTO media_items (library_id, type, local_key, title, sort_title,
         search_text, metadata, match_state, added_at, updated_at)
       VALUES (?, 'movie', ?, ?, ?, ?, ?, 'auto', ?, ?) RETURNING id`
    )
    .get(
      libraryId,
      `k${++seq}`,
      code,
      code.toLowerCase(),
      code.toLowerCase(),
      JSON.stringify(metadata),
      addedAt,
      addedAt
    )!
  return Number(row.id)
}

/** 假资料来源：按名字回表里的资料；表里没有为 null；throws 里的名字抛错。记录每次查询。 */
export function fakeSource(
  id: ActorSource['id'],
  data: Record<string, Partial<ActorProfile>>,
  options: {
    capability?: ActorSource['capability']
    genders?: ActorSource['genders']
    throws?: Set<string>
    /** 查询前等待（测取消）。 */
    wait?: (signal?: AbortSignal) => Promise<void>
  } = {}
): ActorSource & { calls: string[] } {
  const calls: string[] = []
  return {
    id,
    label: id,
    capability: options.capability ?? 'profile',
    genders: options.genders ?? ['female', 'male'],
    calls,
    async fetch(name, ctx) {
      calls.push(name)
      await options.wait?.(ctx.signal)
      if (options.throws?.has(name)) throw new Error(`${id} 被拦`)
      const hit = data[name]
      if (!hit) return null
      return { source: id, name, aliases: [], images: [], ids: {}, ...hit }
    },
  }
}
