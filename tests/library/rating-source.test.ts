/**
 * 评分来源：来源映射与文案、NFO 评分来源、入库时记来源（豆瓣优先）、v12 迁移推断老数据。
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate } from '../../src/main/library/db/migrations'
import { MetadataWriter } from '../../src/main/library/identify/metadata-writer'
import { parseNfoDetails } from '../../src/shared/library/identify'
import type { MediaMetadata } from '../../src/shared/library/provider'
import { formatRating, ratingSourceOf } from '../../src/shared/library/rating'

describe('ratingSourceOf', () => {
  it('NFO <rating name> 换成评分来源，大小写与空白不敏感，认不出的是 nfo', () => {
    expect(ratingSourceOf('douban')).toBe('douban')
    expect(ratingSourceOf(' Douban ')).toBe('douban')
    expect(ratingSourceOf('themoviedb')).toBe('tmdb')
    expect(ratingSourceOf('tmdb')).toBe('tmdb')
    expect(ratingSourceOf('IMDb')).toBe('imdb')
    expect(ratingSourceOf('metacritic')).toBe('nfo')
    expect(ratingSourceOf(undefined)).toBe('nfo')
  })
})

describe('formatRating', () => {
  it('知道来源时带来源名，不知道或 NFO 没写来源时只有分数', () => {
    expect(formatRating(8.2, 'douban')).toBe('豆瓣 8.2')
    expect(formatRating(7.94, 'tmdb')).toBe('TMDB 7.9')
    expect(formatRating(8, 'imdb')).toBe('IMDb 8.0')
    expect(formatRating(8.2, 'nfo')).toBe('8.2')
    expect(formatRating(8.2, null)).toBe('8.2')
    expect(formatRating(8.2)).toBe('8.2')
  })

  it('没有评分（null / 0 / NaN）返回空串', () => {
    expect(formatRating(null, 'douban')).toBe('')
    expect(formatRating(undefined)).toBe('')
    expect(formatRating(0, 'tmdb')).toBe('')
    expect(formatRating(Number(''), 'douban')).toBe('')
    expect(formatRating(Number('abc'), 'douban')).toBe('')
  })
})

describe('NFO 评分来源', () => {
  it('有豆瓣那一条时优先取豆瓣，即使 default 是别的', () => {
    const d = parseNfoDetails(`<movie><ratings>
  <rating name="themoviedb" max="10" default="true"><value>7.9</value></rating>
  <rating name="douban" max="10"><value>8.4</value></rating>
</ratings></movie>`)
    expect(d).toMatchObject({ rating: 8.4, ratingSource: 'douban' })
  })

  it('豆瓣那一条没有分值时退回 default', () => {
    const d = parseNfoDetails(`<movie><ratings>
  <rating name="douban"><value></value></rating>
  <rating name="imdb" default="true"><value>8.1</value></rating>
</ratings></movie>`)
    expect(d).toMatchObject({ rating: 8.1, ratingSource: 'imdb' })
  })

  it('没写 name 与旧式 <rating> 是 nfo；没有评分就没有来源', () => {
    expect(
      parseNfoDetails(
        '<movie><ratings><rating max="10"><value>6.6</value></rating></ratings></movie>'
      )
    ).toMatchObject({ rating: 6.6, ratingSource: 'nfo' })
    expect(parseNfoDetails('<movie><rating>7</rating></movie>')).toMatchObject({
      rating: 7,
      ratingSource: 'nfo',
    })
    expect(parseNfoDetails('<movie><plot>x</plot></movie>')).not.toHaveProperty(
      'ratingSource'
    )
  })
})

/** 迁到 version 版的内存库，带一个媒体库。 */
function dbAt(version = MIGRATIONS.at(-1)!.version): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(
    db,
    MIGRATIONS.filter(m => m.version <= version)
  )
  db.prepare(
    `INSERT INTO libraries (root, root_display, kind, name, created_at)
     VALUES ('/m', '/m', 'tv', '库', 0)`
  ).run()
  return db
}

/** 插一个条目，返回 id。 */
function insertItem(
  db: DatabaseSync,
  key: string,
  fields: {
    type?: string
    parent?: number
    rating?: number
    metadata?: unknown
  } = {}
): number {
  const row = db
    .prepare(
      `INSERT INTO media_items
         (library_id, type, parent_id, local_key, title, match_state, rating, metadata,
          added_at, updated_at)
       VALUES (1, ?, ?, ?, ?, 'auto', ?, ?, 0, 0) RETURNING id`
    )
    .get(
      fields.type ?? 'movie',
      fields.parent ?? null,
      key,
      key,
      fields.rating ?? null,
      fields.metadata === undefined ? null : JSON.stringify(fields.metadata)
    )
  return Number(row!.id)
}

const ratingOf = (
  db: DatabaseSync,
  id: number
): { rating: number | null; source: string | null } => {
  const row = db
    .prepare('SELECT rating, rating_source FROM media_items WHERE id = ?')
    .get(id)!
  return {
    rating: row.rating === null ? null : Number(row.rating),
    source: row.rating_source === null ? null : String(row.rating_source),
  }
}

function tmdbMeta(rating?: number): MediaMetadata {
  return {
    ref: { provider: 'tmdb', kind: 'movie', id: '949' },
    title: '盗火线',
    genres: [],
    ...(rating === undefined ? {} : { rating }),
    countries: [],
    companies: [],
    cast: [],
    crew: [],
    images: [],
    externalIds: { tmdb: '949' },
  }
}

describe('入库记评分来源', () => {
  it('TMDB 识别记 tmdb，没有评分不记；集记 tmdb；清掉元数据时来源一起清', () => {
    const db = dbAt()
    const writer = new MetadataWriter(db)
    const id = insertItem(db, 'a')
    writer.writeTitle(id, tmdbMeta(7.9), 'auto', {}, 1)
    expect(ratingOf(db, id)).toEqual({ rating: 7.9, source: 'tmdb' })
    writer.writeTitle(id, tmdbMeta(), 'auto', {}, 2)
    expect(ratingOf(db, id)).toEqual({ rating: null, source: null })

    const ep = insertItem(db, 'e', { type: 'episode', parent: id })
    writer.writeEpisode(
      ep,
      { season: 1, episode: 1, title: 'x', rating: 8 },
      null,
      false,
      3
    )
    expect(ratingOf(db, ep)).toEqual({ rating: 8, source: 'tmdb' })
    writer.clearChild(ep)
    expect(ratingOf(db, ep)).toEqual({ rating: null, source: null })

    writer.writeTitle(id, tmdbMeta(7.9), 'auto', {}, 4)
    writer.clearTitle(id, 5)
    expect(ratingOf(db, id)).toEqual({ rating: null, source: null })
  })

  it('NFO 补评分：只补空的，来源按 NFO 写的；没写来源的是 nfo', () => {
    const db = dbAt()
    const writer = new MetadataWriter(db)
    const blank = insertItem(db, 'a')
    writer.fillLocal(blank, { rating: 6.5 }, 'nfo', 1)
    expect(ratingOf(db, blank)).toEqual({ rating: 6.5, source: 'nfo' })

    const tmdb = insertItem(db, 'b')
    writer.writeTitle(tmdb, tmdbMeta(7.9), 'auto', {}, 1)
    expect(
      writer.fillLocal(tmdb, { rating: 8.1, ratingSource: 'imdb' }, 'nfo', 2)
    ).toBe(false)
    expect(ratingOf(db, tmdb)).toEqual({ rating: 7.9, source: 'tmdb' })
  })

  it('豆瓣优先：本地补到豆瓣评分替换 TMDB 的，之后重新识别也不覆盖', () => {
    const db = dbAt()
    const writer = new MetadataWriter(db)
    const id = insertItem(db, 'a')
    writer.writeTitle(id, tmdbMeta(7.9), 'auto', {}, 1)
    expect(
      writer.fillLocal(id, { rating: 8.4, ratingSource: 'douban' }, 'nfo', 2)
    ).toBe(true)
    expect(ratingOf(db, id)).toEqual({ rating: 8.4, source: 'douban' })
    // 再补一次同样的豆瓣评分：没有改动
    expect(
      writer.fillLocal(id, { rating: 8.4, ratingSource: 'douban' }, 'nfo', 3)
    ).toBe(false)
    writer.writeTitle(id, tmdbMeta(7.7), 'auto', {}, 4)
    expect(ratingOf(db, id)).toEqual({ rating: 8.4, source: 'douban' })
  })
})

describe('v12 迁移：推断老数据的评分来源', () => {
  it('评分与 TMDB 元数据一致的记 tmdb（含集），NFO 补的与来源不明的留 NULL', () => {
    const db = dbAt(11)
    const tmdb = insertItem(db, 'tmdb', {
      rating: 7.912,
      metadata: { level: 'title', ...tmdbMeta(7.912) },
    })
    const nfo = insertItem(db, 'nfo', {
      rating: 8.4,
      metadata: { level: 'title', ...tmdbMeta() },
    })
    const local = insertItem(db, 'local', {
      rating: 6.5,
      metadata: { level: 'local', countries: ['CN'], source: 'nfo' },
    })
    const bare = insertItem(db, 'bare', { rating: 5 })
    const none = insertItem(db, 'none', {
      metadata: { level: 'title', ...tmdbMeta() },
    })
    const ep = insertItem(db, 'ep', {
      type: 'episode',
      parent: tmdb,
      rating: 8,
      metadata: {
        level: 'episode',
        season: 1,
        episode: 1,
        title: 'x',
        rating: 8,
      },
    })
    const jav = insertItem(db, 'jav', {
      rating: 7,
      metadata: {
        level: 'title',
        ...tmdbMeta(7),
        ref: { provider: 'jav', kind: 'movie', id: 'ABC-123' },
      },
    })
    db.prepare("UPDATE media_items SET metadata = '{bad' WHERE id = ?").run(
      bare
    )

    migrate(db)

    expect(ratingOf(db, tmdb)).toEqual({ rating: 7.912, source: 'tmdb' })
    expect(ratingOf(db, ep)).toEqual({ rating: 8, source: 'tmdb' })
    expect(ratingOf(db, nfo).source).toBeNull()
    expect(ratingOf(db, local).source).toBeNull()
    expect(ratingOf(db, bare).source).toBeNull()
    expect(ratingOf(db, none)).toEqual({ rating: null, source: null })
    expect(ratingOf(db, jav).source).toBeNull()
  })

  it('来源只认已知的几种', () => {
    const db = dbAt()
    const id = insertItem(db, 'a', { rating: 7 })
    expect(() =>
      db
        .prepare("UPDATE media_items SET rating_source = 'foo' WHERE id = ?")
        .run(id)
    ).toThrow(/CHECK/)
  })
})
