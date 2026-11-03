import { describe, expect, it } from 'vitest'

import { openLibraryDb } from '../../src/main/library/db/database'
import { DomainRegistry } from '../../src/server/domains/registry'
import {
  STATE_KEYS,
  createPlayback,
  registerPlayback,
  sqliteUserState,
} from '../../src/server/playback'
import type { DoubanItem } from '../../src/shared/douban/item'
import type { ContinueMeta } from '../../src/shared/playback/continue-rules'

const meta: ContinueMeta = {
  section: 'online',
  key: 'site:42',
  title: '某剧',
  cover: 'https://img.example.com/c.jpg',
}
const replay = {
  playlist: [
    { url: 'https://v.example.com/1.m3u8', name: '第 1 集' },
    { url: 'https://v.example.com/2.m3u8', name: '第 2 集' },
  ],
  index: 0,
}

const card = (url: string): DoubanItem => ({
  title: '片',
  searchTitle: '片',
  original_title: '',
  cover: 'c',
  coverSrc: 'c',
  rate: '8.0',
  url,
  year: '2024',
  type: '电影',
  overview: '',
  kind: 'movie',
})

function setup(): {
  db: ReturnType<typeof openLibraryDb>
  clock: { now: number }
  playback: ReturnType<typeof createPlayback>
} {
  const db = openLibraryDb(':memory:')
  const clock = { now: 1_000 }
  const playback = createPlayback(
    sqliteUserState(db, () => clock.now),
    () => clock.now
  )
  return { db, clock, playback }
}

describe('服务端播放记录（ADR-0031）', () => {
  it('开播登记、记进度、看完一集换下一集、最后一集看完移除', () => {
    const { clock, playback } = setup()
    const id = playback.continueStart(meta, replay, 0)
    expect(id).toBe('online:site:42')

    clock.now = 2_000
    playback.continueProgress(id, { index: 0, progress: 600, duration: 1500 })
    expect(playback.continueList()[0]).toMatchObject({
      progress: 600,
      duration: 1500,
      episode: '第 1 集',
    })

    playback.continueProgress(id, {
      index: 0,
      progress: 1500,
      duration: 1500,
      ended: true,
    })
    expect(playback.continueList()[0]).toMatchObject({
      nextUp: true,
      episode: '第 2 集',
      replay: { index: 1 },
    })

    playback.continueFinish(id)
    expect(playback.continueList()).toEqual([])
  })

  it('移除记墓碑，存法与桌面 localStorage 相同（[id, 时间] 数组）', () => {
    const { db, clock, playback } = setup()
    const id = playback.continueStart(meta, replay, 0)
    clock.now = 5_000
    playback.continueRemove(id)

    expect(playback.continueList()).toEqual([])
    const state = sqliteUserState(db)
    expect(state.read(STATE_KEYS.tombstones, raw => raw)).toEqual([[id, 5_000]])
  })

  it('在线进度与已看合起来查询', () => {
    const { clock, playback } = setup()
    const key = 'https://v.example.com/movie.m3u8'
    expect(playback.progressGet(key)).toBeNull()

    playback.progressSave(key, 120, 5400)
    expect(playback.progressGet(key)).toEqual({
      progress: 120,
      duration: 5400,
      finished: false,
      updatedAt: 1_000,
    })

    clock.now = 9_000
    playback.markWatched(key)
    expect(playback.progressGet(key)).toMatchObject({
      finished: true,
      updatedAt: 9_000,
    })
  })

  it('收藏按豆瓣链接切换，新收藏在前', () => {
    const { playback } = setup()
    expect(playback.toggleFavorite(card('u1'))).toBe(true)
    expect(playback.toggleFavorite(card('u2'))).toBe(true)
    expect(playback.favorites().map(f => f.url)).toEqual(['u2', 'u1'])
    expect(playback.toggleFavorite(card('u1'))).toBe(false)
    expect(playback.favorites().map(f => f.url)).toEqual(['u2'])
  })

  it('同一个数据库重新打开后记录还在', () => {
    const { db, playback } = setup()
    playback.continueStart(meta, replay, 30)
    const again = createPlayback(sqliteUserState(db))
    expect(again.continueList()[0]).toMatchObject({ progress: 30 })
  })

  it('存储里的 JSON 坏了按空处理，不让接口报错', () => {
    const { db, playback } = setup()
    db.prepare(
      'INSERT INTO user_state (key, value, updated_at) VALUES (?, ?, 0)'
    ).run(STATE_KEYS.continue, '{坏的')
    expect(playback.continueList()).toEqual([])
  })
})

describe('playback 域的入参校验', () => {
  const registry = (): DomainRegistry => {
    const r = new DomainRegistry()
    registerPlayback(r, openLibraryDb(':memory:'))
    return r
  }

  it('片库板块的记录不收：片库进度走 progress.save', async () => {
    const result = await registry().invoke('playback', 'continueStart', [
      { ...meta, section: 'movie' },
      replay,
      0,
    ])
    expect(result).toMatchObject({ ok: false })
  })

  it('没有任何播放地址的载荷、负数秒数、不完整的豆瓣卡都拒绝', async () => {
    const r = registry()
    for (const [method, args] of [
      ['continueStart', [meta, { index: 0 }, 0]],
      ['progressSave', ['k', -1, 0]],
      ['toggleFavorite', [{ url: 'u' }]],
    ] as const) {
      expect(await r.invoke('playback', method, [...args])).toMatchObject({
        ok: false,
      })
    }
  })

  it('合法调用经域登记表走通', async () => {
    const r = registry()
    const started = await r.invoke('playback', 'continueStart', [
      meta,
      replay,
      0,
    ])
    expect(started).toEqual({ ok: true, value: 'online:site:42' })
    expect(await r.invoke('playback', 'continueList', [])).toMatchObject({
      ok: true,
      value: [{ id: 'online:site:42', title: '某剧' }],
    })
  })

  it('下标为负、片名为空、没有任何地址都拒绝', async () => {
    const r = registry()
    for (const args of [
      [meta, { ...replay, index: -1 }, 0],
      [{ ...meta, title: '  ' }, replay, 0],
    ]) {
      expect(await r.invoke('playback', 'continueStart', args)).toMatchObject({
        ok: false,
      })
    }
    expect(
      await r.invoke('playback', 'continueProgress', [
        'online:site:42',
        { index: -1, progress: 1, duration: 1 },
      ])
    ).toMatchObject({ ok: false })
  })

  it('收藏只存豆瓣卡的已知字段，超大的 detail 不存', async () => {
    const r = registry()
    await r.invoke('playback', 'toggleFavorite', [
      { ...card('u1'), extra: 'x'.repeat(1000) },
    ])
    const favs = (await r.invoke('playback', 'favorites', [])) as {
      value: Record<string, unknown>[]
    }
    expect(Object.keys(favs.value[0])).not.toContain('extra')

    await r.invoke('playback', 'continueStart', [
      { ...meta, detail: { big: 'x'.repeat(70 * 1024) } },
      replay,
      0,
    ])
    const list = (await r.invoke('playback', 'continueList', [])) as {
      value: Record<string, unknown>[]
    }
    expect(list.value[0].detail).toBeUndefined()
  })
})

describe('进度表的键', () => {
  it('对象原型上的名字不会被当成有记录', () => {
    const { playback } = setup()
    expect(playback.progressGet('constructor')).toBeNull()
    expect(playback.progressGet('toString')).toBeNull()
  })
})
