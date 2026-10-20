/**
 * 媒体库基准：扫描耗时 + 文件名解析准确率。
 *
 * 用法：pnpm bench:library [--files 50000] [--runs 3] [--skip-scan] [--skip-parse]
 *
 * 1. 在系统临时目录生成约 5 万个文件的假媒体库，测 src/main/media-scanner.ts 的
 *    冷扫（无旧索引）、热扫（目录未变）和“深层变更后热扫”的耗时，并检查深层变更是否被发现。
 *    文件都是空文件、跑在同一台机器的页缓存上，“冷扫”指没有旧索引，不是冷磁盘。
 * 2. 在 tests/fixtures/media-names 黄金集上测旧解析（avid.cleanSearchParams 与 TV 两处
 *    extractEpisodeNumber）和新解析器（src/shared/library/parser）的逐类准确率。
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  type MediaIndexEntry,
  scanMediaDirectory,
} from '../src/main/media-scanner'
import { cleanSearchParams } from '../src/renderer/src/utils/avid'
import {
  type GoldenCase,
  compareParse,
  goldenCases,
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

/** 生成假媒体库：根目录下直接放电影文件夹和剧集文件夹（混合库的常见布局）。 */
function createFakeLibrary(targetFiles: number): FakeLibrary {
  const root = mkdtempSync(join(tmpdir(), 'yingbox-bench-'))
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
    const dir = join(root, `Movie ${i} (${1950 + (i % 75)})`)
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
    const showDir = join(root, `Show ${show}`)
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
const pct = (t: Tally): string =>
  t.total ? `${((t.ok / t.total) * 100).toFixed(1)}%` : '—'
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
      bump(t.lt, legacyTitleOk(c))
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

  const head = [
    `黄金集 ${goldenCases.length} 条（手写 ${goldenCases.filter(c => c.hand).length} 条）。`,
    '旧逻辑只看文件名、没有类型判断，所以“旧·片名”允许结果里带着年份或英文副标题；“—”表示该类没有此字段。',
    parse
      ? `新解析器单条平均 ${((parseMs / goldenCases.length) * 1000).toFixed(1)} µs。`
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

async function main(): Promise<void> {
  const sections: string[] = []
  if (!args.includes('--skip-scan'))
    sections.push('## 扫描\n', await benchScanner())
  if (!args.includes('--skip-parse'))
    sections.push('\n## 解析准确率\n', await benchParse())
  process.stdout.write(`${sections.join('\n')}\n`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
