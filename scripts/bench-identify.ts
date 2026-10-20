/**
 * 识别吞吐与准确率基准：合成 N 部电影（含同名翻拍、续集、片名带年份、无年份文件），
 * 用假 TMDB（每个请求固定延迟，默认 100 ms）跑真实引擎的识别任务。
 *
 *   pnpm bench:identify                 # 1000 部，100 ms 延迟，20 rps
 *   N=300 LATENCY=100 RPS=20 pnpm bench:identify
 *
 * 两轮：缓存未命中（空缓存）与缓存命中（同一数据库强制重新识别）。
 * 准确率按合成数据的真值统计：自动匹配正确 / 自动匹配错误 / 待确认（真值是否在前 3）/ 未匹配。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { LibraryService } from '../src/main/library/engine/service'
import type { IdentifyProgressEvent } from '../src/shared/library/ipc'
import {
  FAKE_TOKEN,
  FakeTmdb,
  type Json,
} from '../tests/library/providers/fake-tmdb'

const N = Number(process.env.N ?? 1000)
const LATENCY = Number(process.env.LATENCY ?? 100)
const RPS = Number(process.env.RPS ?? 20)

/** 确定性随机数（mulberry32）。 */
function rng(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = rng(42)
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]

const EN =
  'Silent River Iron Moon Lost Empire Night Falcon Crimson Harbor Golden Shadow Last Winter Broken Arrow Glass Garden Hidden Kingdom Wild Signal Paper Tiger Electric Dream Burning Sky Frozen Road Velvet Storm Distant Echo Black Orchid Hollow Crown Silver Lake Midnight Train Scarlet Code Endless Summer Rogue Planet Quiet Storm Northern Light Desert Rose Fallen Star'.split(
    ' '
  )
const ZH =
  '长河 铁月 失落 帝国 夜鹰 赤港 金影 寒冬 断箭 琉璃 秘境 野信 纸虎 电梦 焚天 冻途 绒暴 远声 墨兰 空冠 银湖 午夜 绯码 长夏 流星 静雷 北光 沙玫 坠星 春潮'.split(
    ' '
  )

interface Truth {
  file: string
  id: string
}

/** 合成 TMDB 电影详情（只含识别与入库用到的字段）。 */
function movieJson(
  id: number,
  en: string,
  zh: string,
  year: number,
  runtime: number,
  popularity: number
): Json {
  return {
    id,
    title: zh,
    original_title: en,
    original_language: 'en',
    release_date: `${year}-0${1 + (id % 9)}-15`,
    runtime,
    popularity,
    vote_average: 7,
    vote_count: 100,
    poster_path: `/p${id}.jpg`,
    backdrop_path: `/b${id}.jpg`,
    genres: [{ id: 1, name: '剧情' }],
    credits: { cast: [], crew: [] },
    images: { posters: [], backdrops: [], logos: [] },
    external_ids: {},
    translations: {
      translations: [
        {
          iso_639_1: 'zh',
          iso_3166_1: 'CN',
          data: { title: zh, overview: '简介' },
        },
        {
          iso_639_1: 'en',
          iso_3166_1: 'US',
          data: { title: en, overview: 'Overview' },
        },
      ],
    },
    alternative_titles: { titles: [] },
    release_dates: { results: [] },
  }
}

/** 生成合成世界与文件。 */
function generate(): {
  fixtures: Map<string, Json>
  truth: Truth[]
  kinds: Record<string, number>
} {
  const fixtures = new Map<string, Json>()
  const truth: Truth[] = []
  const kinds: Record<string, number> = {}
  const movies: Array<{ id: number; en: string; zh: string; year: number }> = []
  for (let i = 0; i < N; i++) {
    const id = 100_000 + i
    const roll = rand()
    let en: string
    let zh: string
    let year = 1960 + Math.floor(rand() * 64)
    let kind: string
    if (movies.length > 10 && roll < 0.15) {
      // 同名翻拍：片名相同、年份不同
      const base = pick(movies)
      en = base.en
      zh = base.zh
      year = base.year + (rand() < 0.5 ? -1 : 1) * (3 + Math.floor(rand() * 20))
      kind = 'remake'
    } else if (movies.length > 10 && roll < 0.25) {
      // 续集
      const base = pick(movies)
      en = `${base.en} 2`
      zh = `${base.zh}2`
      year = base.year + 2 + Math.floor(rand() * 3)
      kind = 'sequel'
    } else if (roll < 0.3) {
      // 片名里带年份
      const titleYear = 1950 + Math.floor(rand() * 60)
      en = `${pick(EN)} ${pick(EN)} ${titleYear}`
      zh = `${pick(ZH)}${pick(ZH)}${titleYear}`
      kind = 'year-in-title'
    } else {
      en = `${pick(EN)} ${pick(EN)} ${pick(EN)}`
      zh = `${pick(ZH)}${pick(ZH)}${pick(ZH)}`
      kind = 'plain'
    }
    const runtime = 85 + Math.floor(rand() * 90)
    fixtures.set(
      `/movie/${id}`,
      movieJson(id, en, zh, year, runtime, rand() * 100)
    )
    movies.push({ id, en, zh, year })

    // 文件名写法
    const dotted = en.replace(/ /g, '.')
    const style = rand()
    let file: string
    if (style < 0.55) file = `${dotted}.${year}.1080p.BluRay.x264-GRP.mkv`
    else if (style < 0.7) file = `${zh}.${dotted}.${year}.2160p.WEB-DL.mkv`
    else if (style < 0.9) file = `${en} (${year})/${en}.mkv`
    else {
      file = `${en} [${i}]/${dotted}.mkv`
      kind += '+no-year'
    }
    kinds[kind] = (kinds[kind] ?? 0) + 1
    truth.push({ file, id: String(id) })
  }
  return { fixtures, truth, kinds }
}

async function main(): Promise<void> {
  const { fixtures, truth, kinds } = generate()
  const root = mkdtempSync(join(tmpdir(), 'yingbox-bench-id-'))
  const dbDir = mkdtempSync(join(tmpdir(), 'yingbox-bench-db-'))
  for (const t of truth) {
    const path = join(root, t.file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '')
  }
  const tmdb = new FakeTmdb({ fixtures, latencyMs: LATENCY, token: FAKE_TOKEN })
  const service = new LibraryService({
    dbPath: join(dbDir, 'library.db'),
    watch: false,
    identify: {
      fetch: tmdb.fetch,
      env: { tmdbToken: FAKE_TOKEN },
      http: { rps: RPS, concurrency: 8 },
      probeDuration: async () => undefined,
    },
  })
  let finished: IdentifyProgressEvent | undefined
  let started = 0
  service.subscribe(e => {
    if (e.type === 'identify-progress') {
      if (!started) started = performance.now()
      if (e.finished) finished = e
    }
  })
  await service.start()

  // 第一轮：扫描入库（会自动排识别），只计识别阶段
  const t0 = performance.now()
  const lib = await service.addLibrary({ root, kind: 'movie' })
  await service.queue.idle()
  const coldMs = performance.now() - (started || t0)
  const coldRequests = tmdb.requests.length
  const cold = finished!

  // 准确率
  const fileTop = service.db.prepare(
    `SELECT i.id, i.tmdb_id, i.match_state FROM files f
     JOIN file_media fm ON fm.file_id = f.id JOIN media_items i ON i.id = fm.item_id
     WHERE f.display_path = ?`
  )
  const candidates = service.db.prepare(
    'SELECT provider_id FROM matches WHERE item_id = ? ORDER BY confidence DESC'
  )
  const acc = {
    autoCorrect: 0,
    autoWrong: 0,
    reviewHit: 0,
    reviewMiss: 0,
    unmatched: 0,
  }
  const wrong: string[] = []
  for (const t of truth) {
    const row = fileTop.get(join(root, t.file))!
    const state = String(row.match_state)
    if (state === 'auto') {
      if (String(row.tmdb_id) === t.id) acc.autoCorrect++
      else {
        acc.autoWrong++
        if (wrong.length < 10)
          wrong.push(`${t.file} → ${row.tmdb_id}（应为 ${t.id}）`)
      }
    } else if (state === 'review') {
      const ids = candidates
        .all(Number(row.id))
        .map(r => String(r.provider_id).split(':')[1])
      if (ids.includes(t.id)) acc.reviewHit++
      else acc.reviewMiss++
    } else acc.unmatched++
  }

  // 第二轮：缓存命中（强制重新识别）
  finished = undefined
  started = 0
  const t1 = performance.now()
  service.identify({ libraryId: lib.id, force: true })
  await service.queue.idle()
  const warmMs = performance.now() - t1
  const warmRequests = tmdb.requests.length - coldRequests

  const result = {
    movies: N,
    latencyMs: LATENCY,
    rps: RPS,
    mix: kinds,
    cold: {
      ms: Math.round(coldMs),
      perSecond: +(N / (coldMs / 1000)).toFixed(1),
      requests: coldRequests,
      requestsPerMovie: +(coldRequests / N).toFixed(2),
      matched: cold.matched,
      review: cold.review,
      unmatched: cold.unmatched,
    },
    warm: {
      ms: Math.round(warmMs),
      perSecond: +(N / (warmMs / 1000)).toFixed(1),
      requests: warmRequests,
    },
    accuracy: {
      ...acc,
      autoPrecision: +(
        acc.autoCorrect /
        (acc.autoCorrect + acc.autoWrong)
      ).toFixed(4),
      wrongExamples: wrong,
    },
  }
  console.log(JSON.stringify(result, null, 2))
  await service.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
}

void main()
