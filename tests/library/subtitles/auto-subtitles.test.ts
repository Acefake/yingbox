/**
 * 自动字幕（真实片库 + 临时目录 + 假 OpenSubtitles）：下好的字幕名字与编码、已有中文字幕不下、
 * 远程源跳过、没搜到按退避重试、每日上限、额度用完停到明天、关着时什么都不做。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import {
  type AutoSubtitleSettings,
  AutoSubtitles,
} from '../../../src/main/library/subtitles/auto-subtitles'
import {
  type OsFetch,
  OsSubtitleClient,
} from '../../../src/main/library/subtitles/os-subtitles'
import type { LibraryArrival } from '../../../src/shared/library/arrivals'
import { tempTree } from '../engine/helpers'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\n你好\n'

/** 假 OpenSubtitles：记下请求；hits 为空时搜不到；quota 为 true 时下载回 406。 */
interface FakeOs {
  fetch: OsFetch
  calls: string[]
}

type FakeResponse = Awaited<ReturnType<OsFetch>>

function fakeOs(options: { hits?: number; quota?: boolean } = {}): FakeOs {
  const calls: string[] = []
  const fetch: OsFetch = async (url, init) => {
    calls.push(`${init.method ?? 'GET'} ${url.replace(/\?.*/, '')}`)
    const json = (body: unknown, status = 200): FakeResponse => ({
      status,
      text: async () => JSON.stringify(body),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    if (url.includes('/subtitles?'))
      return json({
        data: Array.from({ length: options.hits ?? 1 }, (_, i) => ({
          attributes: {
            language: 'zh-cn',
            download_count: 10 - i,
            files: [{ file_id: 100 + i }],
          },
        })),
      })
    if (url.endsWith('/download'))
      return options.quota
        ? json({ message: 'quota' }, 406)
        : json({ link: 'https://dl.example/sub.srt', remaining: 4 })
    const bytes = new TextEncoder().encode(SRT)
    return {
      status: 200,
      text: async () => SRT,
      arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    }
  }
  return { fetch, calls }
}

let tree: ReturnType<typeof tempTree>
let service: LibraryService
beforeEach(async () => {
  tree = tempTree()
  service = new LibraryService({ dbPath: ':memory:', watch: false })
  await service.start()
})
afterEach(async () => {
  await service.close()
  tree.cleanup()
})

/** 入库几部电影，标上 TMDB id，返回对应的新入库。 */
async function movies(...names: string[]): Promise<LibraryArrival[]> {
  for (const name of names) tree.write(`${name}/${name}.mkv`)
  await service.addLibrary({
    root: tree.root,
    kind: 'movie',
    automation: { identify: false },
  })
  await service.queue.idle()
  service.db.exec("UPDATE media_items SET tmdb_id = '438631'")
  return service.db
    .prepare(
      `SELECT i.id, i.library_id, i.title, f.display_path FROM media_items i
       JOIN file_media fm ON fm.item_id = i.id JOIN files f ON f.id = fm.file_id
       WHERE i.type = 'movie' ORDER BY i.title`
    )
    .all()
    .map(row => ({
      itemId: Number(row.id),
      libraryId: Number(row.library_id),
      kind: 'movie' as const,
      topId: Number(row.id),
      title: String(row.title),
      year: null,
      season: null,
      episode: null,
      episodeTitle: null,
      matched: true,
      filePath: String(row.display_path),
      addedAt: 0,
    }))
}

function create(
  os: FakeOs,
  settings: Partial<AutoSubtitleSettings> = {},
  clock = { now: Date.now() }
): AutoSubtitles {
  const subs = new AutoSubtitles({
    db: service.db,
    client: new OsSubtitleClient({
      fetch: os.fetch,
      apiKey: () => 'k',
      now: () => clock.now,
      sleep: async () => {},
    }),
    settings: async () => ({ enabled: true, dailyLimit: 5, ...settings }),
    isCloud: async () => false,
    now: () => clock.now,
  })
  return subs
}

const statusOf = (subs: AutoSubtitles): Array<[string, string | null]> =>
  Object.values(subs.snapshot().entries).map(
    e => [e.status, e.reason] as [string, string | null]
  )

describe('AutoSubtitles', () => {
  it('没有中文字幕时下载最匹配的，存成 视频名.zh.srt（UTF-8 带 BOM）', async () => {
    const os = fakeOs({ hits: 2 })
    const subs = create(os)
    const [dune] = await movies('Dune (2021)')
    await subs.enqueue([dune])
    const target = join(tree.root, 'Dune (2021)', 'Dune (2021).zh.srt')
    expect(readFileSync(target, 'utf8')).toBe(`\ufeff${SRT}`)
    expect(os.calls).toEqual([
      'GET https://api.opensubtitles.com/api/v1/subtitles',
      'POST https://api.opensubtitles.com/api/v1/download',
      'GET https://dl.example/sub.srt',
    ])
    expect(statusOf(subs)).toEqual([['done', '已下载 Dune (2021).zh.srt']])
    expect(subs.snapshot().downloads).toBe(1)
    // 同一条再来一次不再处理
    await subs.enqueue([dune])
    expect(os.calls).toHaveLength(3)
  })

  it('已有中文外挂 / 同名无标记但内容是中文：不下', async () => {
    const os = fakeOs()
    const subs = create(os)
    const [a, b] = await movies('A (2001)', 'B (2002)')
    tree.write('A (2001)/A (2001).chs.ass', 'x')
    tree.write('B (2002)/B (2002).srt', SRT)
    await subs.enqueue([a, b])
    expect(os.calls).toEqual([])
    expect(statusOf(subs)).toEqual([
      ['done', '已有中文外挂字幕'],
      ['done', '已有中文外挂字幕'],
    ])
  })

  it('内封中文字幕（本地库才探测）：不下', async () => {
    const os = fakeOs()
    const subs = new AutoSubtitles({
      db: service.db,
      client: new OsSubtitleClient({ fetch: os.fetch, apiKey: () => 'k' }),
      settings: async () => ({ enabled: true, dailyLimit: 5 }),
      isCloud: async () => false,
      probeStreams: async () => ({
        streams: [{ codec_type: 'subtitle', tags: { language: 'chi' } }],
      }),
    })
    await subs.enqueue(await movies('C (2003)'))
    expect(os.calls).toEqual([])
    expect(statusOf(subs)).toEqual([['done', '已有中文内封字幕']])
  })

  it('远程源跳过并记原因', async () => {
    const os = fakeOs()
    const subs = create(os)
    const [dune] = await movies('Dune (2021)')
    await subs.enqueue([{ ...dune, filePath: 'yingbox-dav://nas/Dune.mkv' }])
    expect(statusOf(subs)).toEqual([
      ['skipped', '远程源（WebDAV）上不能写字幕'],
    ])
  })

  it('没搜到：1 小时、6 小时、1 天后各再试一次，都没有就跳过', async () => {
    const os = fakeOs({ hits: 0 })
    const clock = { now: Date.now() }
    const subs = create(os, {}, clock)
    const [dune] = await movies('Dune (2021)')
    await subs.enqueue([dune])
    let entry = Object.values(subs.snapshot().entries)[0]
    expect([entry.status, entry.attempts, entry.nextTry]).toEqual([
      'pending',
      1,
      clock.now + 3_600_000,
    ])
    for (const step of [3_600_000, 6 * 3_600_000, 24 * 3_600_000]) {
      clock.now += step
      await subs.run()
    }
    entry = Object.values(subs.snapshot().entries)[0]
    expect([entry.status, entry.attempts]).toEqual(['skipped', 4])
    subs.close()
  })

  it('每日上限：到了就推到明天', async () => {
    const os = fakeOs()
    const subs = create(os, { dailyLimit: 1 })
    await subs.enqueue(await movies('A (2001)', 'B (2002)'))
    const entries = Object.values(subs.snapshot().entries)
    expect(entries.map(e => e.status).sort()).toEqual(['done', 'pending'])
    expect(entries.find(e => e.status === 'pending')?.reason).toBe(
      '今天的自动字幕次数已用完'
    )
    subs.close()
  })

  it('OpenSubtitles 额度用完：停到明天，不算一次失败', async () => {
    const os = fakeOs({ quota: true })
    const subs = create(os)
    await subs.enqueue(await movies('Dune (2021)'))
    const entry = Object.values(subs.snapshot().entries)[0]
    expect([entry.status, entry.attempts]).toEqual(['pending', 0])
    expect(entry.nextTry).toBeGreaterThan(Date.now())
    expect(
      existsSync(join(tree.root, 'Dune (2021)', 'Dune (2021).zh.srt'))
    ).toBe(false)
    subs.close()
  })

  it('关着时不登记、不请求', async () => {
    const os = fakeOs()
    const subs = create(os, { enabled: false })
    await subs.enqueue(await movies('Dune (2021)'))
    expect(os.calls).toEqual([])
    expect(subs.snapshot().entries).toEqual({})
  })
})
