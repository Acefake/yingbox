/**
 * 演员库存储：V6 迁移、条目 ↔ 演员同步、列表（排序 / 搜索 / 媒体库）、资料读写、NFO 资料、按演员查作品。
 */
import { describe, expect, it } from 'vitest'
import { ActorStore } from '../../../src/main/library/actors/actor-store'
import { CatalogQuery } from '../../../src/main/library/catalog/query'
import {
  MIGRATIONS,
  schemaVersion,
} from '../../../src/main/library/db/migrations'
import {
  type ActorProfileValues,
  type ItemMetadata,
  normalizeLibraryQuery,
  parseActorQuery,
} from '../../../src/shared/library/ipc'
import { addMovie, memoryDb } from './helpers'

const metaOf = (
  db: ReturnType<typeof memoryDb>['db'],
  id: number
): ItemMetadata =>
  JSON.parse(
    String(
      db.prepare('SELECT metadata FROM media_items WHERE id = ?').get(id)!
        .metadata
    )
  ) as ItemMetadata

/** 同步全部番号条目。 */
function syncAll(store: ActorStore): void {
  for (const item of store.javItems(null))
    store.syncItem(item.id, item.metadata, 1)
}

describe('演员库存储', () => {
  it('迁移到 V6：演员表、关联表与检索表都在', () => {
    const { db } = memoryDb()
    expect(schemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table')")
      .all()
      .map(r => String(r.name))
    expect(names).toEqual(
      expect.arrayContaining(['actors', 'item_actors', 'actors_fts'])
    )
  })

  it('同名（归一后）只建一行，作品数正确；演员表变化时关联跟着变；未匹配清空关联', () => {
    const { db, libraryId } = memoryDb()
    const store = new ActorStore(db)
    const a = addMovie(db, libraryId, 'SSIS-001', ['三上悠亜', '河北彩花'])
    const b = addMovie(db, libraryId, 'SSIS-002', ['三上悠亜 ', 'ｱｲｳ'])
    syncAll(store)
    const all = store.list(parseActorQuery({ sort: 'works' }))
    expect(all.total).toBe(3)
    expect(all.items[0]).toMatchObject({ name: '三上悠亜', workCount: 2 })
    expect(store.forItem(a).map(x => x.name)).toEqual(['三上悠亜', '河北彩花'])
    // 半角片假名 NFKC 归一
    expect(store.forItem(b).map(x => x.name)).toEqual(['三上悠亜', 'アイウ'])

    const meta = metaOf(db, a)
    if (meta.level !== 'title') throw new Error('bad meta')
    const { touched, created } = store.syncItem(
      a,
      { ...meta, cast: [meta.cast[1]] },
      2
    )
    expect(created).toEqual([])
    expect(touched.length).toBe(2)
    expect(store.forItem(a).map(x => x.name)).toEqual(['河北彩花'])
    store.syncItem(b, null, 3)
    expect(store.forItem(b)).toEqual([])
    // 没有作品的演员不出现在列表里，但行还在（保留用户编辑过的资料）
    expect(store.list(parseActorQuery({})).items.map(x => x.name)).toEqual([
      '河北彩花',
    ])
    expect(db.prepare('SELECT COUNT(*) AS n FROM actors').get()!.n).toBe(3)
  })

  it('TMDB 库的条目不参与', () => {
    const { db } = memoryDb('tmdb')
    const store = new ActorStore(db)
    addMovie(db, 1, 'Movie', ['Tom Hanks'])
    expect(store.javItems(null)).toEqual([])
  })

  it('列表：按名字 / 别名搜索（短词走 LIKE，长词走 FTS）、按媒体库、按最近入库', () => {
    const { db, libraryId } = memoryDb()
    const other = Number(
      db
        .prepare(
          "INSERT INTO libraries (root, root_display, kind, name, created_at, source) VALUES ('/x', '/x', 'movie', 'x', 1, 'jav') RETURNING id"
        )
        .get()!.id
    )
    const store = new ActorStore(db)
    addMovie(db, libraryId, 'A-1', ['Alpha'], 10)
    addMovie(db, other, 'B-1', ['Beta'], 20)
    syncAll(store)
    const alpha = store.list(parseActorQuery({ search: 'alp' })).items[0]
    store.writeProfile(
      alpha.id,
      'Alpha',
      {
        values: {
          ...emptyValues(),
          aliases: ['あるふぁ', 'Alfa Romeo'],
        },
        fieldSources: {},
      },
      { photo: null, now: 5 }
    )
    expect(
      store.list(parseActorQuery({ search: 'romeo' })).items.map(x => x.name)
    ).toEqual(['Alpha'])
    expect(
      store.list(parseActorQuery({ search: 'ふぁ' })).items.map(x => x.name)
    ).toEqual(['Alpha'])
    expect(
      store.list(parseActorQuery({ libraryId: other })).items.map(x => x.name)
    ).toEqual(['Beta'])
    expect(
      store.list(parseActorQuery({ sort: 'recent' })).items.map(x => x.name)
    ).toEqual(['Beta', 'Alpha'])
    expect(
      store.list(parseActorQuery({ sort: 'name', limit: 1, offset: 1 }))
    ).toMatchObject({
      total: 2,
      items: [{ name: 'Beta' }],
    })
  })

  it('资料读写往返；NFO 资料按演员表写法查得到；按演员查作品', () => {
    const { db, libraryId } = memoryDb()
    const store = new ActorStore(db)
    const item = addMovie(db, libraryId, 'SSIS-1', ['Mia'])
    addMovie(db, libraryId, 'SSIS-2', ['Other'])
    syncAll(store)
    const id = store.forItem(item)[0].id
    store.writeProfile(
      id,
      'Mia',
      {
        values: {
          ...emptyValues(),
          birthday: '1993-08-16',
          height: 160,
          bust: 83,
          waist: 57,
          hip: 85,
          cup: 'E',
          images: ['https://img/1.jpg'],
        },
        fieldSources: { birthday: 'avbase' },
        ids: { avbase: 'mia' },
        urls: { avbase: 'https://avbase/mia' },
        tagline: '女优',
      },
      {
        photo: 'yingbox-media://image/abc',
        lockedFields: ['cup'],
        state: 'found',
        now: 9,
      }
    )
    expect(store.record(id)).toMatchObject({
      birthday: '1993-08-16',
      photo: 'yingbox-media://image/abc',
      lockedFields: ['cup'],
      profileState: 'found',
      profileAt: 9,
      ids: { avbase: 'mia' },
      tagline: '女优',
    })
    expect(store.nfoProfiles(item).get(' mia ')).toEqual({
      thumb: 'https://img/1.jpg',
      birthday: '1993-08-16',
      height: 160,
      measurements: '83-57-85',
      cup: 'E',
    })
    const works = new CatalogQuery(db).list(
      normalizeLibraryQuery({ actorId: id })
    )
    expect(works.items.map(w => w.title)).toEqual(['SSIS-1'])
  })

  it('待查列表：新建的、上次全部失败且过了一天的', () => {
    const { db, libraryId } = memoryDb()
    const store = new ActorStore(db)
    addMovie(db, libraryId, 'A-1', ['A', 'B', 'C'])
    syncAll(store)
    const [a, b] = store.linkedIds()
    const write = (id: number, state: 'found' | 'error', now: number): void =>
      store.writeProfile(
        id,
        'x',
        { values: emptyValues(), fieldSources: {} },
        { photo: null, state, now }
      )
    write(a, 'found', 1)
    write(b, 'error', 1000)
    expect(store.pendingIds(2000).length).toBe(1)
    expect(store.pendingIds(1000 + 86_400_001).length).toBe(2)
  })
})

function emptyValues(): ActorProfileValues {
  return {
    aliases: [],
    gender: null,
    birthday: null,
    birthplace: null,
    height: null,
    bust: null,
    waist: null,
    hip: null,
    cup: null,
    overview: null,
    images: [],
  }
}
