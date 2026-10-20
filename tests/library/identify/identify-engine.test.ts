/**
 * 识别链 + 打分 + 元数据入库的集成测试：真实引擎（内存库、临时目录）+ 假 TMDB（fixture 响应）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import type {
  ItemMetadata,
  LibraryEvent,
  LibraryInfo,
  LibraryKind,
} from '../../../src/shared/library/ipc'
import { tempTree } from '../engine/helpers'
import { FAKE_TOKEN, FakeTmdb } from '../providers/fake-tmdb'

let tree: ReturnType<typeof tempTree>
let mediaDir: string
beforeEach(() => {
  tree = tempTree()
  mediaDir = mkdtempSync(join(tmpdir(), 'yingbox-media-'))
})
afterEach(() => {
  tree.cleanup()
  rmSync(mediaDir, { recursive: true, force: true })
})

/** 探测时长的假实现：按文件名给秒数。 */
const durations: Record<string, number> = {}

/** 测试环境：引擎、假 TMDB、事件，以及按文件名查顶层条目的工具。 */
interface Env {
  service: LibraryService
  tmdb: FakeTmdb
  lib: LibraryInfo
  events: LibraryEvent[]
  cachedKeys: string[]
  items: () => ItemRow[]
  byFile: (name: string) => ItemRow | undefined
}

interface ItemRow {
  id: number
  title: string
  year: number | null
  tmdb: string | null
  state: string
  poster: string | null
  key: string
}

async function engine(
  kind: LibraryKind,
  files: Record<string, string> = {}
): Promise<Env> {
  for (const [path, content] of Object.entries(files)) tree.write(path, content)
  const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
  const events: LibraryEvent[] = []
  const cachedKeys: string[] = []
  const service = new LibraryService({
    dbPath: ':memory:',
    watch: false,
    identify: {
      fetch: tmdb.fetch,
      mediaDir,
      env: { tmdbToken: FAKE_TOKEN },
      probeDuration: async path => durations[basename(path)],
      onImagesCached: keys => cachedKeys.push(...keys),
    },
  })
  service.subscribe(e => events.push(e))
  await service.start()
  const lib = await service.addLibrary({ root: tree.root, kind })
  await service.queue.idle()
  const items = (): ItemRow[] =>
    service.db
      .prepare(
        `SELECT id, title, year, tmdb_id, match_state, poster, local_key FROM media_items
         WHERE parent_id IS NULL ORDER BY id`
      )
      .all()
      .map(r => ({
        id: Number(r.id),
        title: String(r.title),
        year: r.year === null ? null : Number(r.year),
        tmdb: r.tmdb_id === null ? null : String(r.tmdb_id),
        state: String(r.match_state),
        poster: r.poster === null ? null : String(r.poster),
        key: String(r.local_key),
      }))
  const byFile = (name: string): ItemRow | undefined => {
    const row = service.db
      .prepare(
        `SELECT COALESCE(gp.id, p.id, i.id) AS top FROM files f
         JOIN file_media fm ON fm.file_id = f.id
         JOIN media_items i ON i.id = fm.item_id
         LEFT JOIN media_items p ON p.id = i.parent_id
         LEFT JOIN media_items gp ON gp.id = p.parent_id
         WHERE f.name = ?`
      )
      .get(name)
    return items().find(i => i.id === Number(row?.top))
  }
  return { service, tmdb, lib, events, cachedKeys, items, byFile }
}

describe('电影识别', () => {
  it('中文片、同名不同年、续集、繁体片名、中英双标题、片名带年份', async () => {
    const env = await engine('movie', {
      '流浪地球 (2019)/流浪地球.2019.2160p.mkv': '',
      '流浪地球2.2023.WEB-DL.mkv': '',
      'Heat.1995.1080p.mkv': '',
      'Heat.1986.DVDRip.mkv': '',
      '霸王別姬 (1993)/霸王別姬.1993.mkv': '',
      '寄生虫.Parasite.2019.mkv': '',
      'Dune.2021.mkv': '',
      'Dune.Part.Two.2024.mkv': '',
      '无间道2.2003.mkv': '',
      'Wonder.Woman.1984.mkv': '',
    })
    const expected: Record<string, [string, string]> = {
      '流浪地球.2019.2160p.mkv': ['535167', '流浪地球'],
      '流浪地球2.2023.WEB-DL.mkv': ['842675', '流浪地球2'],
      'Heat.1995.1080p.mkv': ['949', '盗火线'],
      'Heat.1986.DVDRip.mkv': ['29386', 'Heat'],
      '霸王別姬.1993.mkv': ['10997', '霸王别姬'],
      '寄生虫.Parasite.2019.mkv': ['496243', '寄生虫'],
      'Dune.2021.mkv': ['438631', '沙丘'],
      'Dune.Part.Two.2024.mkv': ['693134', '沙丘2'],
      '无间道2.2003.mkv': ['11647', '无间道2'],
      'Wonder.Woman.1984.mkv': ['464052', '神奇女侠1984'],
    }
    for (const [file, [id, title]] of Object.entries(expected)) {
      expect(env.byFile(file), file).toMatchObject({
        tmdb: id,
        title,
        state: 'auto',
      })
    }
    await env.service.close()
  })

  it('元数据入库：简介、类型、评分、时长、分级、演职员、外部 ID；海报缓存成 yingbox-media 地址', async () => {
    const env = await engine('movie', {
      '流浪地球 (2019)/流浪地球.2019.mkv': '',
    })
    const item = env.byFile('流浪地球.2019.mkv')!
    const node = env.service.getItem({ itemId: item.id })!
    expect(node).toMatchObject({
      title: '流浪地球',
      year: 2019,
      overview: '太阳即将毁灭，人类开启“流浪地球”计划。',
      runtime: 125,
      genres: ['科幻', '冒险'],
      rating: 7.5,
      providerIds: { tmdb: '535167', imdb: 'tt7605074' },
      matchState: 'auto',
    })
    expect(node.poster).toMatch(/^yingbox-media:\/\/image\/[0-9a-f]{32}$/)
    expect(node.backdrop).toMatch(/^yingbox-media:\/\/image\//)
    const meta = node.metadata as Extract<ItemMetadata, { level: 'title' }>
    expect(meta.cast.map(c => c.name)).toEqual(['吴京', '屈楚萧', '李光洁'])
    expect(meta.crew).toEqual([
      expect.objectContaining({ name: '郭帆', job: 'Director' }),
      expect.objectContaining({ name: '龚格尔', job: 'Screenplay' }),
    ])
    expect(meta.certification).toBe('NR')
    expect(env.cachedKeys).toHaveLength(2)
    // FTS：中英文都能搜到
    expect(env.service.query({ ...q, search: '流浪地球' }).total).toBe(1)
    await env.service.close()
  })

  it('NFO 里的 ID 优先；同名无年份临时合并的不同影片按匹配结果拆开', async () => {
    durations['沙丘.mkv'] = 155 * 60
    const env = await engine('movie', {
      '沙丘A/沙丘.mkv': '',
      '沙丘B/沙丘.mkv': 'x',
      '沙丘B/movie.nfo': '<movie><uniqueid type="tmdb">841</uniqueid></movie>',
    })
    const dunes = env.items().filter(i => i.title === '沙丘')
    expect(dunes.map(i => i.tmdb).sort()).toEqual(['438631', '841'])
    // 原条目留给其中一部，另一部拆到 local_key 带 #tmdb:<id> 的新条目
    const split = dunes.filter(i => i.key.includes('#tmdb:'))
    expect(split).toHaveLength(1)
    expect(split[0].key.endsWith(`#tmdb:${split[0].tmdb}`)).toBe(true)
    delete durations['沙丘.mkv']
    await env.service.close()
  })

  it('时长参与打分：同名无年份时用文件时长区分', async () => {
    durations['沙丘.mkv'] = 137 * 60
    const env = await engine('movie', { 'Old/沙丘.mkv': '' })
    expect(env.items()[0]).toMatchObject({ tmdb: '841' })
    delete durations['沙丘.mkv']
    await env.service.close()
  })

  it('置信度不够进待确认（存前 3 候选），搜不到为未匹配；手动搜索 / 指定 ID / 锁定', async () => {
    const env = await engine('movie', {
      '让子弹飞.2015.mkv': '',
      '完全不存在的电影.2020.mkv': '',
    })
    const review = env.byFile('让子弹飞.2015.mkv')!
    expect(review.state).toBe('review')
    const cands = env.service.getMatchCandidates({ itemId: review.id })
    expect(cands.current).toBeNull()
    expect(cands.candidates[0]).toMatchObject({
      id: '51533',
      title: '让子弹飞',
      year: 2010,
    })
    expect(cands.candidates[0].confidence).toBeGreaterThan(0.6)
    expect(cands.candidates[0].confidence).toBeLessThan(0.85)
    expect(env.byFile('完全不存在的电影.2020.mkv')!.state).toBe('unmatched')

    // 按用户给的标题和年份重新搜索：够自信直接应用
    const applied = await env.service.applyMatch({
      itemId: review.id,
      query: { title: '让子弹飞', year: 2010 },
    })
    expect(applied).toMatchObject({
      status: 'matched',
      item: { matchState: 'auto', providerIds: { tmdb: '51533' } },
    })

    // 直接指定 ID：默认锁定，之后强制重新识别也不改
    const other = env.byFile('完全不存在的电影.2020.mkv')!
    const locked = await env.service.applyMatch({
      itemId: other.id,
      tmdbId: '603',
    })
    expect(locked.item).toMatchObject({
      matchState: 'locked',
      title: '黑客帝国',
    })
    env.service.identify({ libraryId: env.lib.id, force: true })
    await env.service.queue.idle()
    expect(env.byFile('完全不存在的电影.2020.mkv')).toMatchObject({
      tmdb: '603',
      state: 'locked',
    })
    expect(
      env.service.getMatchCandidates({ itemId: other.id }).current
    ).toMatchObject({ id: '603' })

    // 解锁后回到自动
    expect(env.service.unlockMatch({ itemId: other.id }).matchState).toBe(
      'auto'
    )
    expect(env.service.lockMatch({ itemId: other.id }).matchState).toBe(
      'locked'
    )
    await expect(
      env.service.applyMatch({ itemId: other.id, tmdbId: '999999' })
    ).rejects.toMatchObject({ code: 'not-found' })
    await env.service.close()
  })

  it('进度事件：identify-progress 最后一条 finished，统计与结果一致', async () => {
    const env = await engine('movie', {
      'Heat.1995.mkv': '',
      '完全不存在的电影.2020.mkv': '',
    })
    const progress = env.events.filter(e => e.type === 'identify-progress')
    expect(progress.at(-1)).toMatchObject({
      finished: true,
      total: 2,
      done: 2,
      matched: 1,
      unmatched: 1,
      failed: 0,
    })
    expect(env.events.some(e => e.type === 'items-changed')).toBe(true)
    await env.service.close()
  })

  it('令牌无效：任务失败、提示原因，不逐个重试', async () => {
    tree.write('Heat.1995.mkv')
    const tmdb = new FakeTmdb({ token: 'eyJ.other' })
    const events: LibraryEvent[] = []
    const service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      identify: { fetch: tmdb.fetch, env: { tmdbToken: FAKE_TOKEN } },
    })
    service.subscribe(e => events.push(e))
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    await service.queue.idle()
    expect(tmdb.requests).toHaveLength(1)
    expect(
      events.find(
        e =>
          e.type === 'job' && e.jobType === 'identify' && e.state === 'failed'
      )
    ).toMatchObject({
      error: expect.stringContaining('API 令牌'),
    })
    await service.close()
  })

  it('扫描后自动识别只处理新增 / 变化的条目，已识别的不再搜索', async () => {
    const env = await engine('movie', { 'Heat.1995.mkv': '' })
    const searches = env.tmdb.count('/search/')
    tree.write('Dune.2021.mkv')
    await env.service.scan({ libraryId: env.lib.id }).jobId
    await env.service.queue.idle()
    expect(env.byFile('Dune.2021.mkv')).toMatchObject({ tmdb: '438631' })
    // 只为新文件搜索了一次（带年份、足够自信），Heat 没有重新搜索
    expect(
      env.tmdb.requests.slice(-3).filter(r => r.startsWith('/search/'))
    ).toEqual([
      '/search/movie?include_adult=false&language=zh-CN&page=1&query=Dune&year=2021',
    ])
    expect(env.tmdb.count('/search/')).toBe(searches + 1)
    await env.service.close()
  })

  it('刷新元数据：缓存过期后走 ETag 条件请求', async () => {
    const env = await engine('movie', { 'Heat.1995.mkv': '' })
    const item = env.byFile('Heat.1995.mkv')!
    const before = env.tmdb.count('/movie/949')
    env.service.refreshMetadata({ itemIds: [item.id] })
    await env.service.queue.idle()
    expect(env.tmdb.count('/movie/949')).toBe(before + 1)
    expect(env.service.identifier.http.stats.notModified).toBe(1)
    await env.service.close()
  })
})

describe('剧集识别', () => {
  it('Reply 1988：年份其实是剧名的一部分；季 / 集 / 特别篇元数据', async () => {
    const env = await engine('tv', {
      'Reply 1988/Reply 1988 S01E05.mkv': '',
      'Reply 1988/Reply 1988 S01E06.mkv': '',
      'Reply 1988/Specials/Reply 1988 S00E01.mkv': '',
    })
    const [series] = env.items()
    expect(series).toMatchObject({
      tmdb: '64010',
      title: '请回答1988',
      state: 'auto',
    })
    const node = env.service.getItem({ itemId: series.id })!
    const seasons = node.children.map(s => [
      s.seasonNumber,
      s.title,
      s.children.map(e => [e.episodeNumber, e.title]),
    ])
    expect(seasons).toEqual([
      [0, '特别篇', [[1, '特别篇 1']]],
      [
        1,
        '第 1 季',
        [
          [5, '第 5 集'],
          [6, '第 6 集'],
        ],
      ],
    ])
    const ep = node.children[1].children[0]
    expect(ep.overview).toBe('S01E05 简介')
    expect(ep.poster).toBe('https://image.tmdb.org/t/p/w300/t64010s1e5.jpg')
    await env.service.close()
  })

  it('中文剧名文件夹；tvshow.nfo 的 tvdb ID；TMDB 上不存在的集清空元数据', async () => {
    const env = await engine('tv', {
      '请回答1988/Season 1/请回答1988.S01E02.mkv': '',
      '绝命毒师/tvshow.nfo':
        '<tvshow><uniqueid type="tvdb">81189</uniqueid></tvshow>',
      '绝命毒师/Season 1/BB.S01E02.mkv': '',
      '绝命毒师/Season 1/BB.S01E09.mkv': '',
    })
    const [reply, bb] = env.items()
    expect(reply).toMatchObject({ tmdb: '64010' })
    expect(bb).toMatchObject({ tmdb: '1396', title: '绝命毒师' })
    const eps = env.service.getItem({ itemId: bb.id })!.children[0].children
    // 第一季只有 7 集：E09 没有元数据
    expect(eps.map(e => [e.episodeNumber, e.matchState, e.title])).toEqual([
      [2, 'auto', '第 2 集'],
      [9, 'unmatched', ''],
    ])
    await env.service.close()
  })

  it('动画绝对集数：有绝对分组时按分组映射（含插入的特别篇），没有时按季拼接', async () => {
    const env = await engine('tv', {
      '进击的巨人/Attack on Titan - 14.mkv': '',
      '进击的巨人/Attack on Titan - 30.mkv': '',
      'One Piece/[Sub] One Piece - 62 [1080p].mkv': '',
    })
    const aot = env.byFile('Attack on Titan - 14.mkv')!
    const op = env.byFile('[Sub] One Piece - 62 [1080p].mkv')!
    expect(aot).toMatchObject({ tmdb: '1429', title: '进击的巨人' })
    expect(op).toMatchObject({ tmdb: '37854', title: '海贼王' })
    const meta = (id: number): unknown[][] =>
      env.service.getItem({ itemId: id })!.children.map(e => {
        const m = e.metadata as Extract<ItemMetadata, { level: 'episode' }>
        return [e.episodeNumber, m.season, m.episode, m.mapped]
      })
    expect(meta(aot.id)).toEqual([
      [14, 0, 1, true],
      [30, 2, 4, true],
    ])
    expect(meta(op.id)).toEqual([[62, 2, 1, true]])
    await env.service.close()
  })
})

const q = {
  types: ['movie', 'series'] as Array<'movie' | 'series'>,
  sort: 'title' as const,
  order: 'asc' as const,
  offset: 0,
  limit: 100,
}
