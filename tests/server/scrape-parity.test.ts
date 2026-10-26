/**
 * 电影 / 剧集刮削在独立服务上与桌面端一致（对照表见 docs/library-refactor/nas-scrape-parity.md）：
 * 假 TMDB + 假豆瓣 + 假 ffprobe，走 HTTP RPC：
 * 建库自动识别（TMDB 令牌来自环境变量）→ 季集 → 豆瓣补类型 → 多版本合并（动态范围来自 ffprobe 探测）
 * → 写出 NFO 与图片 → 整理预览 → 观看进度导出 / 导入（桌面端同步用）。
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HttpFetch } from '../../src/main/library/identify/identify-module'
import type {
  JobAccepted,
  LibraryItemNode,
  LibraryItemSummary,
  OrganizeEntry,
  ProgressSyncEntry,
} from '../../src/shared/library/ipc'
import { FAKE_TOKEN, FakeTmdb } from '../library/providers/fake-tmdb'
import { type Harness, startServer } from './server-harness'

const posix = process.platform !== 'win32'
const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
// 让黑客帝国没有 TMDB 类型，刮削后由豆瓣补
;(tmdb.fixtures.get('/movie/603') as { genres: unknown[] }).genres = []
const doubanRequests: string[] = []
const fetchAll = (async (url: string, init: never) => {
  const host = new URL(url).hostname
  if (host !== 'm.douban.com') return tmdb.fetch(url, init)
  doubanRequests.push(url)
  const body = {
    items: [
      {
        target_type: 'movie',
        target: {
          title: '黑客帝国',
          year: '1999',
          card_subtitle: '1999 / 美国 澳大利亚 / 动作 科幻 / 莉莉·沃卓斯基',
        },
      },
    ],
  }
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}) as unknown as HttpFetch

let h: Harness
let tools: string

beforeAll(async () => {
  // 假 ffprobe：不管参数，都回 HDR10 的探测结果
  tools = mkdtempSync(join(tmpdir(), 'yingbox-tools-'))
  const ffprobe = join(tools, 'ffprobe')
  const fixture = resolve('tests/fixtures/ffprobe/hdr10.json')
  writeFileSync(ffprobe, `#!/bin/sh\ncat '${fixture}'\n`)
  chmodSync(ffprobe, 0o755)
  h = await startServer({
    fetch: fetchAll,
    env: {
      YINGBOX_TMDB_TOKEN: FAKE_TOKEN,
      YINGBOX_FFPROBE: posix ? ffprobe : join(tools, 'missing'),
    },
    files: {
      'movies/The Matrix (1999)/The.Matrix.1999.1080p.mkv': 2048,
      'movies/The Matrix 1999 2160p/The.Matrix.1999.2160p.mkv': 4096,
      'tv/Breaking Bad/Season 01/Breaking.Bad.S01E01.mkv': 1024,
      'tv/Breaking Bad/Season 01/Breaking.Bad.S01E02.mkv': 1024,
    },
  })
  await h.ok('addLibrary', { root: join(h.media, 'movies'), kind: 'movie' })
  await h.ok('addLibrary', { root: join(h.media, 'tv'), kind: 'tv' })
  await h.app.service.queue.idle()
})

afterAll(async () => {
  await h?.close()
  rmSync(tools, { recursive: true, force: true })
})

const top = async (type: string): Promise<LibraryItemSummary[]> =>
  (
    await h.ok<{ items: LibraryItemSummary[] }>('query', { sort: 'title' })
  ).items.filter(item => item.type === type)

describe('识别与刮削', () => {
  it('TMDB：环境变量里的令牌生效，电影自动识别，两份文件合并成一个作品', async () => {
    expect(
      (await h.ok<{ tmdb: { configured: boolean } }>('getProviderStatus')).tmdb
        .configured
    ).toBe(true)
    const movies = await top('movie')
    expect(movies).toHaveLength(1)
    expect(movies[0]).toMatchObject({
      matchState: 'auto',
      providerIds: { tmdb: '603' },
    })
    expect(movies[0].poster).toMatch(/^yingbox-media:\/\/image\//)
  })

  it('季、集识别：剧 → 第 1 季 → 两集', async () => {
    const [show] = await top('series')
    expect(show).toMatchObject({ providerIds: { tmdb: '1396' } })
    const node = await h.ok<LibraryItemNode>('getItem', { itemId: show.id })
    const season = node.children.find(c => c.seasonNumber === 1)!
    expect(season.children.map(e => e.episodeNumber)).toEqual([1, 2])
    expect(season.children.every(e => e.title)).toBe(true)
  })

  it('豆瓣补类型：TMDB 没有类型时按片名 + 年份补上', async () => {
    const [movie] = await top('movie')
    const node = await h.ok<LibraryItemNode>('getItem', { itemId: movie.id })
    expect(doubanRequests.length).toBeGreaterThan(0)
    expect(node.genres).toEqual(expect.arrayContaining(['动作', '科幻']))
  })

  it.skipIf(!posix)(
    '多版本：按分辨率排，动态范围来自 ffprobe 探测（文件名里没有 HDR）',
    async () => {
      const [movie] = await top('movie')
      const node = await h.ok<LibraryItemNode>('getItem', { itemId: movie.id })
      expect(node.versions!.map(v => [v.height, v.range])).toEqual([
        [2160, 'hdr10'],
        [1080, 'hdr10'],
      ])
      expect(new Set(node.versions!.map(v => v.folder)).size).toBe(2)
    }
  )
})

describe('写出与整理', () => {
  it('写出 NFO 与图片到视频旁', async () => {
    const ids = [...(await top('movie')), ...(await top('series'))].map(
      i => i.id
    )
    await h.ok<JobAccepted>('writer.write', { itemIds: ids })
    await h.app.service.queue.idle()
    const movieDir = join(h.media, 'movies/The Matrix (1999)')
    expect(readdirSync(movieDir).some(f => f.endsWith('.nfo'))).toBe(true)
    expect(existsSync(join(h.media, 'tv/Breaking Bad/tvshow.nfo'))).toBe(true)
    const season = readdirSync(join(h.media, 'tv/Breaking Bad/Season 01'))
    expect(season).toContain('Breaking.Bad.S01E01.nfo')
  })

  it('整理改名：预览给出计划（不动文件）', async () => {
    const [show] = await top('series')
    const plan = await h.ok<{ planId: string; entries: OrganizeEntry[] }>(
      'writer.previewOrganize',
      { itemIds: [show.id] }
    )
    expect(plan.planId).toBeTruthy()
    expect(plan.entries.length).toBeGreaterThan(0)
    expect(
      existsSync(
        join(h.media, 'tv/Breaking Bad/Season 01/Breaking.Bad.S01E01.mkv')
      )
    ).toBe(true)
  })
})

describe('观看进度（桌面端同步的对端）', () => {
  it('上报后可按跨库键导出，导入能对上集', async () => {
    const [movie] = await top('movie')
    await h.ok('progress.save', {
      reports: [{ itemId: movie.id, position: 600, duration: 8160, at: 1000 }],
    })
    const exported = await h.ok<ProgressSyncEntry[]>('progress.export', {
      since: 0,
    })
    expect(exported).toEqual([
      expect.objectContaining({ key: 'movie:603', position: 600 }),
    ])
    const imported = await h.ok<{ applied: number; unmatched: number }>(
      'progress.import',
      {
        entries: [
          {
            key: 'tv:1396:1:2',
            position: 0,
            duration: 2900,
            watched: true,
            updatedAt: 2000,
          },
          {
            key: 'movie:999999',
            position: 1,
            duration: 2,
            watched: false,
            updatedAt: 2000,
          },
        ],
      }
    )
    expect(imported).toMatchObject({ applied: 1, unmatched: 1 })
  })
})
