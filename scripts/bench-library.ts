/**
 * 媒体库基准：扫描耗时 + 文件名解析准确率。
 *
 * 用法：pnpm bench:library [--files 50000] [--runs 3] [--skip-scan] [--skip-parse] [--skip-engine]
 *
 * 1. 在系统临时目录生成约 5 万个文件的假媒体库，测 src/main/media-scanner.ts 的
 *    冷扫（无旧索引）、热扫（目录未变）和“深层变更后热扫”的耗时，并检查深层变更是否被发现。
 *    文件都是空文件、跑在同一台机器的页缓存上，“冷扫”指没有旧索引，不是冷磁盘。
 * 2. 在 tests/fixtures/media-names 黄金集上测旧解析（avid.cleanSearchParams 与 TV 两处
 *    extractEpisodeNumber）和新解析器（src/shared/library/parser）的逐类准确率。
 * 3. 媒体库引擎（src/main/library）：同规模假库拆成电影库 + 剧集库，测冷扫入库、无变化重扫、
 *    深层变更重扫、首屏分页查询与各种查询形态的耗时。
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  type MediaIndexEntry,
  scanMediaDirectory,
} from '../src/main/media-scanner'
import { CatalogStore } from '../src/main/library/catalog/catalog-store'
import { CatalogQuery } from '../src/main/library/catalog/query'
import { type LibraryDb, openLibraryDb } from '../src/main/library/db/database'
import {
  type LibraryRecord,
  LibraryStore,
} from '../src/main/library/libraries/library-store'
import { fingerprintFile } from '../src/main/library/scanner/fingerprint'
import { scanLibrary } from '../src/main/library/scanner/scan-library'
import { ScanStore } from '../src/main/library/scanner/scan-store'
import { normalizeLibraryQuery } from '../src/shared/library/ipc'
import { cleanSearchParams } from '../src/renderer/src/utils/avid'
import {
  type GoldenCase,
  compareParse,
  goldenCases,
  holdoutPaths,
} from '../tests/fixtures/media-names'

const args = process.argv.slice(2)
const argValue = (name: string, fallback: number): number => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const TARGET_FILES = argValue('--files', 50000)
const RUNS = argValue('--runs', 3)

// ———————————————————————————— 扫描基准 ————————————————————————————

interface FakeLibrary {
  root: string
  files: number
  dirs: number
  /** 一个位于“剧/季”第二层的目录，用来做深层变更。 */
  deepDir: string
  deepVictim: string
}

/**
 * 生成假媒体库：默认根目录下直接放电影文件夹和剧集文件夹（混合库的常见布局）；
 * split 时电影放 Movies/、剧集放 TV/，给引擎基准建两个不同类型的媒体库。
 */
function createFakeLibrary(targetFiles: number, split = false): FakeLibrary {
  const root = mkdtempSync(join(tmpdir(), 'yingbox-bench-'))
  const movieRoot = split ? join(root, 'Movies') : root
  const showRoot = split ? join(root, 'TV') : root
  if (split) {
    mkdirSync(movieRoot)
    mkdirSync(showRoot)
  }
  let files = 0
  let dirs = 0
  const touch = (p: string): void => {
    writeFileSync(p, '')
    files++
  }
  const mkdir = (p: string): void => {
    mkdirSync(p)
    dirs++
  }

  // 约 40% 电影：每部 视频 + nfo + poster，每 10 部带一个 Featurettes 子目录
  const movieCount = Math.round((targetFiles * 0.4) / 3.2)
  for (let i = 0; i < movieCount; i++) {
    const dir = join(movieRoot, `Movie ${i} (${1950 + (i % 75)})`)
    mkdir(dir)
    touch(join(dir, `Movie ${i} (${1950 + (i % 75)}).mkv`))
    touch(join(dir, 'movie.nfo'))
    touch(join(dir, 'poster.jpg'))
    if (i % 10 === 0) {
      mkdir(join(dir, 'Featurettes'))
      touch(join(dir, 'Featurettes', 'Making Of.mkv'))
      touch(join(dir, 'Featurettes', 'Teaser.mkv'))
    }
  }

  // 其余是剧集：每部 4 季 × 25 集，带 tvshow.nfo 与 poster
  let deepDir = ''
  let deepVictim = ''
  let show = 0
  while (files < targetFiles) {
    const showDir = join(showRoot, `Show ${show}`)
    mkdir(showDir)
    touch(join(showDir, 'tvshow.nfo'))
    touch(join(showDir, 'poster.jpg'))
    for (let s = 1; s <= 4 && files < targetFiles; s++) {
      const seasonDir = join(showDir, `Season ${s}`)
      mkdir(seasonDir)
      for (let e = 1; e <= 25 && files < targetFiles; e++) {
        const name = `Show ${show} S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}.mkv`
        touch(join(seasonDir, name))
        if (!deepDir && s === 2 && e === 5) {
          deepDir = seasonDir
          deepVictim = join(seasonDir, name)
        }
      }
    }
    show++
  }
  return { root, files, dirs, deepDir, deepVictim }
}

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function timeScan(
  root: string,
  index?: MediaIndexEntry[]
): Promise<{
  ms: number
  result: Awaited<ReturnType<typeof scanMediaDirectory>>
}> {
  const start = performance.now()
  const result = await scanMediaDirectory(root, index)
  return { ms: performance.now() - start, result }
}

async function benchScanner(): Promise<string> {
  const genStart = performance.now()
  const lib = createFakeLibrary(TARGET_FILES)
  const genMs = performance.now() - genStart
  try {
    const cold: number[] = []
    const hot: number[] = []
    let index: MediaIndexEntry[] = []
    let entries = 0
    let reused = 0
    for (let r = 0; r < RUNS; r++) {
      const c = await timeScan(lib.root)
      cold.push(c.ms)
      entries = c.result.data.length
      index = c.result.data
      const h = await timeScan(lib.root, index)
      hot.push(h.ms)
      reused = h.result.reused
    }

    // 深层变更：在“剧/季”目录里新增一集、删掉一集。剧目录自身的 mtime 不变。
    const added = join(lib.deepDir, 'Added S02E99.mkv')
    writeFileSync(added, '')
    unlinkSync(lib.deepVictim)
    const deep = await timeScan(lib.root, index)
    const paths = new Set(deep.result.data.map(e => e.path))
    const sawAdded = paths.has(added)
    const sawRemoved = !paths.has(lib.deepVictim)

    return [
      `假媒体库：${lib.files} 个文件、${lib.dirs} 个目录（生成耗时 ${genMs.toFixed(0)} ms），每项取 ${RUNS} 次中位数。`,
      '',
      '| 场景 | 耗时 (ms) | 说明 |',
      '| --- | ---: | --- |',
      `| 冷扫（无旧索引） | ${median(cold).toFixed(0)} | 返回 ${entries} 项 |`,
      `| 热扫（目录未变） | ${median(hot).toFixed(0)} | 复用 ${reused} 项 |`,
      `| 深层变更后热扫 | ${deep.ms.toFixed(0)} | 新增文件${sawAdded ? '已发现' : '**未发现**'}；删除文件${sawRemoved ? '已移除' : '**仍在结果里**'} |`,
    ].join('\n')
  } finally {
    rmSync(lib.root, { recursive: true, force: true })
  }
}

// ———————————————————————————— 解析准确率 ————————————————————————————

/**
 * 旧逻辑快照：src/renderer/src/views/TV/composables/use-tv-file-management.ts（~392）
 * 中的 extractEpisodeNumber，原样复制（它是 composable 内部闭包，无法直接 import）。
 */
function legacyEpisodeFileManagement(name: string): number {
  const base = name.replace(/\.[^.]+$/, '')
  let m: RegExpMatchArray | null
  m = base.match(/s\d+e(\d+)/i)
  if (m) return parseInt(m[1])
  m = base.match(/\d+x(\d+)/i)
  if (m) return parseInt(m[1])
  m = base.match(/\bep\.?\s*(\d+)/i)
  if (m) return parseInt(m[1])
  m = base.match(/\bE(\d{1,3})\b/)
  if (m) return parseInt(m[1])
  m = base.match(/第\s*(\d+)\s*集/)
  if (m) return parseInt(m[1])
  m = base.match(/[\s._-](\d{2,3})[\s._-]/)
  if (m) return parseInt(m[1])
  m = base.match(/^(\d{1,3})$/)
  if (m) return parseInt(m[1])
  return 0
}

/** 旧逻辑快照：use-tv-scraping.ts（~664）中的 extractEpisodeNumber，原样复制。 */
function legacyEpisodeScraping(name: string): number {
  const base = name.replace(/\.[^.]+$/, '')
  let m: RegExpMatchArray | null
  m = base.match(/s\d+e(\d+)/i)
  if (m) return parseInt(m[1])
  m = base.match(/\d+x(\d+)/i)
  if (m) return parseInt(m[1])
  m = base.match(/\bep\.?\s*(\d+)/i)
  if (m) return parseInt(m[1])
  m = base.match(/\bE(\d{1,3})\b/)
  if (m) return parseInt(m[1])
  m = base.match(/第\s*(\d+)\s*集/)
  if (m) return parseInt(m[1])
  return 0
}

/** 旧逻辑快照：use-tv-file-management.ts 中的 extractSeasonFromFilename。 */
function legacySeason(filename: string): number | null {
  const base = filename.replace(/\.[^.]+$/, '')
  const match = base.match(/s(\d+)/i)
  return match ? parseInt(match[1]) : null
}

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** 旧片名清洗算对：结果等于片名，允许带着年份或英文副标题（旧逻辑把它们一起送去搜索）。 */
function legacyTitleOk(c: GoldenCase): boolean {
  const got = norm(cleanSearchParams(fileName(c.path)))
  const { title, altTitle, year } = c.expected
  const y = year ? ` ${year}` : ''
  const variants = [title, `${title}${y}`]
  if (altTitle)
    variants.push(
      `${title} ${altTitle}`,
      `${title} ${altTitle}${y}`,
      `${altTitle} ${title}${y}`
    )
  return variants.some(v => norm(v) === got)
}

interface Tally {
  ok: number
  total: number
}
/** 百分比向下取整到 0.1%，只有全对才显示 100%；不全对时附上失败条数。 */
const pct = (t: Tally): string => {
  if (!t.total) return '—'
  const value = `${(Math.floor((t.ok / t.total) * 1000) / 10).toFixed(1)}%`
  return t.ok === t.total ? value : `${value} (−${t.total - t.ok})`
}
const bump = (t: Tally, ok: boolean): void => {
  t.total++
  if (ok) t.ok++
}

type ParseFn = (path: string) => Record<string, unknown> & { type: string }

async function loadNewParser(): Promise<ParseFn | null> {
  try {
    const mod = await import('../src/shared/library/parser')
    return mod.parseMediaPath as unknown as ParseFn
  } catch {
    return null
  }
}

async function benchParse(): Promise<string> {
  const parse = await loadNewParser()
  const cats = [...new Set(goldenCases.map(c => c.category))]
  const rows: string[] = [
    '| 分类 | 用例数 | 旧·片名 | 旧·集号(file-mgmt) | 旧·集号(scraping) | 旧·季号 | 新·片名 | 新·集号 | 新·季号 | 新·整条全对 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  const total = {
    lt: { ok: 0, total: 0 },
    le1: { ok: 0, total: 0 },
    le2: { ok: 0, total: 0 },
    ls: { ok: 0, total: 0 },
    nt: { ok: 0, total: 0 },
    ne: { ok: 0, total: 0 },
    ns: { ok: 0, total: 0 },
    nall: { ok: 0, total: 0 },
  }
  const failures: string[] = []
  let parseMs = 0
  /** 按来源统计整条全对：手写难例 / 留出集 / 规则生成。 */
  const bySource: Record<string, Tally> = {
    手写难例: { ok: 0, total: 0 },
    留出集: { ok: 0, total: 0 },
    规则生成: { ok: 0, total: 0 },
  }

  for (const cat of cats) {
    const t = {
      lt: { ok: 0, total: 0 },
      le1: { ok: 0, total: 0 },
      le2: { ok: 0, total: 0 },
      ls: { ok: 0, total: 0 },
      nt: { ok: 0, total: 0 },
      ne: { ok: 0, total: 0 },
      ns: { ok: 0, total: 0 },
      nall: { ok: 0, total: 0 },
    }
    const cases = goldenCases.filter(c => c.category === cat)
    for (const c of cases) {
      const name = fileName(c.path)
      const e = c.expected
      const firstEp = e.episodes?.[0]
      if (e.type === 'movie') bump(t.lt, legacyTitleOk(c))
      if (e.type === 'episode' && firstEp !== undefined) {
        bump(t.le1, legacyEpisodeFileManagement(name) === firstEp)
        bump(t.le2, legacyEpisodeScraping(name) === firstEp)
      }
      if (e.type === 'episode' && e.season !== undefined)
        bump(t.ls, legacySeason(name) === e.season)

      if (parse) {
        const s = performance.now()
        const got = parse(c.path)
        parseMs += performance.now() - s
        const diff = compareParse(got as never, e)
        bump(t.nt, !diff.some(d => d.field === 'title'))
        if (e.type === 'episode' && firstEp !== undefined) {
          bump(
            t.ne,
            JSON.stringify(got.episodes ?? []) === JSON.stringify(e.episodes)
          )
        }
        if (e.type === 'episode' && e.season !== undefined)
          bump(t.ns, got.season === e.season)
        bump(t.nall, diff.length === 0)
        const source = holdoutPaths.has(c.path)
          ? '留出集'
          : c.hand
            ? '手写难例'
            : '规则生成'
        bump(bySource[source], diff.length === 0)
        if (diff.length) {
          failures.push(
            `- \`${c.path}\` — ${diff.map(d => `${d.field}: 期望 ${JSON.stringify(d.expected)}，得到 ${JSON.stringify(d.actual)}`).join('；')}`
          )
        }
      }
    }
    for (const k of Object.keys(total) as (keyof typeof total)[]) {
      total[k].ok += t[k].ok
      total[k].total += t[k].total
    }
    rows.push(
      `| ${cat} | ${cases.length} | ${pct(t.lt)} | ${pct(t.le1)} | ${pct(t.le2)} | ${pct(t.ls)} | ${pct(t.nt)} | ${pct(t.ne)} | ${pct(t.ns)} | ${pct(t.nall)} |`
    )
  }
  rows.push(
    `| **合计** | ${goldenCases.length} | ${pct(total.lt)} | ${pct(total.le1)} | ${pct(total.le2)} | ${pct(total.ls)} | ${pct(total.nt)} | ${pct(total.ne)} | ${pct(total.ns)} | ${pct(total.nall)} |`
  )

  if (parse) {
    rows.push(
      '',
      '按来源（新解析器整条全对）：',
      '',
      '| 来源 | 用例数 | 整条全对 |',
      '| --- | ---: | ---: |',
      ...Object.entries(bySource).map(
        ([name, t]) => `| ${name} | ${t.total} | ${pct(t)} |`
      )
    )
  }

  // 吞吐：先完整跑过一遍（上面的准确率循环）预热，再取 3 遍的中位数
  let steadyUs = 0
  if (parse) {
    const passes: number[] = []
    for (let r = 0; r < 3; r++) {
      const s = performance.now()
      for (const c of goldenCases) parse(c.path)
      passes.push(((performance.now() - s) / goldenCases.length) * 1000)
    }
    steadyUs = median(passes)
  }

  const head = [
    `黄金集 ${goldenCases.length} 条（手写 ${goldenCases.filter(c => c.hand).length} 条）。`,
    '“旧·片名”只统计电影（旧流程只对电影文件名用 cleanSearchParams，剧集靠文件夹名），并允许结果里带着年份或英文副标题；旧逻辑没有类型判断和附加内容识别。“—”表示该类没有此字段。',
    parse
      ? `新解析器单条耗时：首遍（含 JIT 预热、缓存未命中）平均 ${((parseMs / goldenCases.length) * 1000).toFixed(1)} µs，预热后 ${steadyUs.toFixed(1)} µs。`
      : '新解析器尚未实现，只给出旧逻辑数字。',
    '',
  ]
  const tail = failures.length
    ? [
        '',
        `<details><summary>新解析器未通过的 ${failures.length} 条</summary>`,
        '',
        ...failures,
        '',
        '</details>',
      ]
    : []
  return [...head, ...rows, ...tail].join('\n')
}

// ———————————————————————————— 引擎基准 ————————————————————————————

/** 整棵树的目录 mtime 拨回一小时前：真实媒体库的目录早就不动了（见 walk.ts 的 racyWindowMs）。 */
function ageDirectories(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) ageDirectories(join(dir, entry.name))
  }
  const t = new Date(Date.now() - 3600_000)
  utimesSync(dir, t, t)
}

/** 打开一个引擎环境（文件数据库，WAL）。 */
function openEngine(dbFile: string): {
  db: LibraryDb
  libraries: LibraryStore
  query: CatalogQuery
  scan: (lib: LibraryRecord) => ReturnType<typeof scanLibrary>
} {
  const db = openLibraryDb(dbFile)
  const scanStore = new ScanStore(db)
  const catalog = new CatalogStore(db)
  return {
    db,
    libraries: new LibraryStore(db),
    query: new CatalogQuery(db),
    scan: lib =>
      scanLibrary(
        {
          db,
          scanStore,
          catalog,
          fingerprint: f => fingerprintFile(f.displayPath),
        },
        lib
      ),
  }
}

async function timed<T>(
  fn: () => Promise<T> | T
): Promise<{ ms: number; value: T }> {
  const start = performance.now()
  const value = await fn()
  return { ms: performance.now() - start, value }
}

async function benchEngine(): Promise<string> {
  const lib = createFakeLibrary(TARGET_FILES, true)
  ageDirectories(lib.root)
  const dbDir = mkdtempSync(join(tmpdir(), 'yingbox-bench-db-'))
  try {
    const cold: number[] = []
    const coldWalk: number[] = []
    const coldWrite: number[] = []
    const hot: number[] = []
    const firstPage: number[] = []
    const warmPage: number[] = []
    let dbFile = ''
    let items = 0
    let rows = 0
    for (let r = 0; r < RUNS; r++) {
      dbFile = join(dbDir, `run-${r}.db`)
      const engine = openEngine(dbFile)
      const movies = engine.libraries.add(
        { root: join(lib.root, 'Movies'), kind: 'movie' },
        Date.now()
      )
      const tv = engine.libraries.add(
        { root: join(lib.root, 'TV'), kind: 'tv' },
        Date.now()
      )

      const c = await timed(async () => [
        await engine.scan(movies),
        await engine.scan(tv),
      ])
      cold.push(c.ms)
      coldWalk.push(c.value.reduce((n, s) => n + s.timings.walk, 0))
      coldWrite.push(
        c.value.reduce((n, s) => n + s.timings.moves + s.timings.write, 0)
      )
      rows = c.value.reduce((n, s) => n + s.added, 0)

      const h = await timed(async () => [
        await engine.scan(movies),
        await engine.scan(tv),
      ])
      hot.push(h.ms)
      engine.db.close()

      // 首屏查询：新开连接（冷语句缓存、冷页缓存之外的一切都是冷的）后的第一次默认查询
      const reopened = openEngine(dbFile)
      const first = await timed(() =>
        reopened.query.list(normalizeLibraryQuery({}))
      )
      firstPage.push(first.ms)
      items = first.value.total
      const warm: number[] = []
      for (let i = 0; i < 20; i++) {
        warm.push(
          (await timed(() => reopened.query.list(normalizeLibraryQuery({})))).ms
        )
      }
      warmPage.push(median(warm))
      reopened.db.close()
    }

    // 各种查询形态（最后一次运行的库，热连接）
    const engine = openEngine(dbFile)
    const shapes: Array<[string, Record<string, unknown>]> = [
      ['默认（片名升序，200 条）', {}],
      ['按添加时间降序', { sort: 'addedAt' }],
      ['按年份降序 + 年份区间', { sort: 'year', yearFrom: 1990, yearTo: 2010 }],
      ['只看剧集', { types: ['series'] }],
      ['FTS 搜索 “Movie 12”', { search: 'Movie 12' }],
      ['短词搜索（LIKE）“12”', { search: '12' }],
      ['深分页 offset 5000', { offset: 5000 }],
    ]
    const shapeRows: string[] = []
    for (const [label, q] of shapes) {
      const normalized = normalizeLibraryQuery(q)
      engine.query.list(normalized)
      const runs: number[] = []
      let total = 0
      for (let i = 0; i < 20; i++) {
        const t = await timed(() => engine.query.list(normalized))
        runs.push(t.ms)
        total = t.value.total
      }
      shapeRows.push(`| ${label} | ${median(runs).toFixed(2)} | ${total} |`)
    }
    const series = engine.query.list(
      normalizeLibraryQuery({ types: ['series'], limit: 1 })
    ).items[0]
    const detail = await timed(() => engine.query.getItem(series.id))
    const episodes = detail.value!.children.reduce(
      (n, s) => n + s.children.length,
      0
    )

    // 深层变更：某季目录里加一集、删一集
    const added = join(lib.deepDir, 'Show 0 S02E99.mkv')
    writeFileSync(added, '')
    unlinkSync(lib.deepVictim)
    const tv = engine.libraries.list().find(l => l.kind === 'tv')!
    const deep = await timed(() => engine.scan(tv))
    engine.db.close()
    const dbBytes =
      statSync(dbFile).size +
      (statSync(`${dbFile}-wal`, { throwIfNoEntry: false })?.size ?? 0)

    return [
      `假媒体库：${lib.files} 个文件、${lib.dirs} 个目录，拆成电影库（Movies/）和剧集库（TV/）两个媒体库；`,
      `目录 mtime 预先拨回一小时前。数据库为临时目录里的文件（WAL）。每项取 ${RUNS} 次中位数。`,
      '',
      '| 场景 | 耗时 (ms) | 目标 | 说明 |',
      '| --- | ---: | ---: | --- |',
      `| 冷扫入库 | ${median(cold).toFixed(0)} | — | 写入 ${rows} 个文件、${items} 个顶层条目；遍历 ${median(coldWalk).toFixed(0)} ms，解析 + 写库 ${median(coldWrite).toFixed(0)} ms |`,
      `| 无变化重扫 | ${median(hot).toFixed(0)} | < 1000 | 只 stat 目录，零写入 |`,
      `| 深层变更重扫（剧集库） | ${deep.ms.toFixed(0)} | — | 新增 ${deep.value.added}、删除 ${deep.value.removed} |`,
      `| 首屏查询（新连接第一次） | ${median(firstPage).toFixed(1)} | < 200 | 默认排序 200 条 + 总数 |`,
      `| 首屏查询（热） | ${median(warmPage).toFixed(2)} | — | 同上，连续 20 次中位数 |`,
      `| getItem（一部剧） | ${detail.ms.toFixed(2)} | — | ${detail.value!.children.length} 季 ${episodes} 集，含文件 |`,
      '',
      `数据库大小：${(dbBytes / 1024 / 1024).toFixed(1)} MiB。`,
      '',
      '查询形态（热连接，20 次中位数）：',
      '',
      '| 查询 | 耗时 (ms) | 命中总数 |',
      '| --- | ---: | ---: |',
      ...shapeRows,
    ].join('\n')
  } finally {
    rmSync(lib.root, { recursive: true, force: true })
    rmSync(dbDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const sections: string[] = []
  if (!args.includes('--skip-scan'))
    sections.push('## 扫描\n', await benchScanner())
  if (!args.includes('--skip-parse'))
    sections.push('\n## 解析准确率\n', await benchParse())
  if (!args.includes('--skip-engine'))
    sections.push('\n## 媒体库引擎\n', await benchEngine())
  process.stdout.write(`${sections.join('\n')}\n`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
