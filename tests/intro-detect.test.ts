// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { compareClips } from '../src/main/intro-detect/detector'
import {
  DEFAULT_MATCH,
  POINT_SECONDS,
  bestMatch,
  candidateShifts,
  matchAtShift,
  popcount32,
} from '../src/main/intro-detect/match'
import { PCM_RATE, pcmFingerprint } from '../src/main/intro-detect/pcm-print'
import { createDetectQueue } from '../src/main/intro-detect/queue'
import {
  type Candidate,
  introCandidates,
  minSupport,
  outroCandidates,
  pairsFor,
  summarize,
  voteSpan,
} from '../src/main/intro-detect/vote'
import { parseDuration } from '../src/main/intro-detect/ffmpeg'
import {
  mergeDetected,
  mergeSummary,
  needsDetection,
  sourceOf,
  stampManual,
} from '../src/renderer/src/features/player/skip/detect-merge'
import {
  putRecord,
  sanitizeSkipRecords,
} from '../src/renderer/src/features/player/skip/skip-rules'
import {
  type IntroDetectRequest,
  introDetect,
} from '../src/shared/contract/intro-detect'
import { settingsSchema } from '../src/shared/settings/schema'

/**
 * 自动检测片头片尾：指纹比对、多集投票、并入标记（手动优先）、检测队列，全部用合成数据。
 */

/** 可复现的伪随机数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randomPrints = (count: number, rand: () => number): number[] =>
  Array.from({ length: count }, () => Math.floor(rand() * 2 ** 32) >>> 0)

/** 给共享片段加「编码差异」：一部分点翻 1–3 位，个别点整个换掉 */
function noisy(points: number[], rand: () => number): number[] {
  return points.map(p => {
    const r = rand()
    if (r < 0.03) return Math.floor(rand() * 2 ** 32) >>> 0
    if (r < 0.35) {
      let out = p
      const flips = 1 + Math.floor(rand() * 3)
      for (let i = 0; i < flips; i++) out ^= 1 << Math.floor(rand() * 32)
      return out >>> 0
    }
    return p
  })
}

const sec = (s: number): number => Math.round(s / POINT_SECONDS)

/** 合成一集：冷开场 + 片头 + 正片，返回指纹 */
function episode(
  seed: number,
  intro: number[],
  coldOpenSeconds: number,
  totalSeconds = 600
): Uint32Array {
  const rand = rng(seed)
  const cold = randomPrints(sec(coldOpenSeconds), rand)
  const rest = randomPrints(
    sec(totalSeconds) - cold.length - intro.length,
    rand
  )
  return Uint32Array.from([...cold, ...noisy(intro, rand), ...rest])
}

const INTRO = randomPrints(sec(60), rng(999))

describe('指纹比对', () => {
  it('popcount32', () => {
    expect(popcount32(0)).toBe(0)
    expect(popcount32(0xffffffff)).toBe(32)
    expect(popcount32(0b1011)).toBe(3)
    expect(popcount32(-1)).toBe(32)
  })

  it('同位置的片头：候选错位为 0，区间与真实片头相差不到 1 秒', () => {
    const a = episode(1, INTRO, 40)
    const b = episode(2, INTRO, 40)
    expect(candidateShifts(a, b)[0]).toBe(0)
    const m = bestMatch(a, b, candidateShifts(a, b))!
    expect(Math.abs(m.a.start - 40)).toBeLessThan(1)
    expect(Math.abs(m.a.end - 100)).toBeLessThan(1)
    expect(m.b).toEqual(m.a)
  })

  it('两集片头位置不同（冷开场长度不同）也能对上', () => {
    const a = episode(3, INTRO, 30)
    const b = episode(4, INTRO, 75)
    const m = bestMatch(a, b, candidateShifts(a, b))!
    expect(Math.abs(m.a.start - 30)).toBeLessThan(1)
    expect(Math.abs(m.b.start - 75)).toBeLessThan(1)
    expect(Math.abs(m.b.end - m.b.start - 60)).toBeLessThan(1.5)
  })

  it('不足 15 秒的公共片段不算', () => {
    const short = INTRO.slice(0, sec(10))
    const a = episode(5, short, 40)
    const b = episode(6, short, 40)
    expect(bestMatch(a, b, candidateShifts(a, b))).toBeNull()
  })

  it('静音 / 单调段（取值几乎不变）不当成片头', () => {
    const silence = new Array<number>(sec(40)).fill(0)
    const a = episode(7, silence, 20)
    const b = episode(8, silence, 20)
    expect(matchAtShift(a, b, 0)).toBeNull()
  })

  it('完全无关的两集没有公共片段', () => {
    const a = Uint32Array.from(randomPrints(sec(300), rng(10)))
    const b = Uint32Array.from(randomPrints(sec(300), rng(11)))
    expect(bestMatch(a, b, candidateShifts(a, b))).toBeNull()
  })

  it('没有完全相同的点时，退回全量扫描仍能找到', async () => {
    // B 的片头每个点都比 A 差 1 位：倒排索引给不出候选
    const rand = rng(13)
    const a = Uint32Array.from([
      ...randomPrints(sec(50), rand),
      ...INTRO,
      ...randomPrints(sec(100), rand),
    ])
    const b = Uint32Array.from([
      ...randomPrints(sec(20), rand),
      ...INTRO.map(p => (p ^ 1) >>> 0),
      ...randomPrints(sec(100), rand),
    ])
    expect(bestMatch(a, b, candidateShifts(a, b))).toBeNull()
    const m = await compareClips(
      a,
      b,
      DEFAULT_MATCH,
      new AbortController().signal
    )
    expect(m).not.toBeNull()
    expect(Math.abs(m!.a.start - 50)).toBeLessThan(1)
    expect(Math.abs(m!.b.start - 20)).toBeLessThan(1)
  })

  it('全量扫描可取消', async () => {
    const a = Uint32Array.from(randomPrints(sec(200), rng(20)))
    const b = Uint32Array.from(randomPrints(sec(200), rng(21)))
    const controller = new AbortController()
    controller.abort()
    expect(
      await compareClips(a, b, DEFAULT_MATCH, controller.signal)
    ).toBeNull()
  })
})

describe('退回方案指纹（PCM 自算）', () => {
  /** 合成一段有起伏的「音乐」：每 0.25 秒换一个音高 */
  function tune(seconds: number, seed: number): Int16Array {
    const rand = rng(seed)
    const out = new Int16Array(Math.round(seconds * PCM_RATE))
    let freq = 440
    for (let i = 0; i < out.length; i++) {
      if (i % Math.round(PCM_RATE / 4) === 0) freq = 300 + rand() * 1500
      out[i] = Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / PCM_RATE))
    }
    return out
  }

  it('每 1365 采样一个点；同一段音频错开整数步长，指纹也只是错开', () => {
    const pcm = tune(30, 1)
    const a = pcmFingerprint(pcm)
    const b = pcmFingerprint(pcm.subarray(1365 * 10))
    expect(a.length).toBe(Math.floor((pcm.length - 4096) / 1365))
    expect(Array.from(b.slice(0, 50))).toEqual(Array.from(a.slice(10, 60)))
  })

  it('静音全为 0，会被单调段过滤掉', () => {
    const prints = pcmFingerprint(new Int16Array(PCM_RATE * 5))
    expect(prints.every(p => p === 0)).toBe(true)
  })

  it('同一段音乐混进不同的前后内容，能比出公共片段', () => {
    const shared = tune(30, 7)
    const build = (seed: number, lead: number): Int16Array => {
      const head = tune(lead, seed)
      const tail = tune(40, seed + 100)
      const out = new Int16Array(head.length + shared.length + tail.length)
      out.set(head)
      out.set(shared, head.length)
      out.set(tail, head.length + shared.length)
      return out
    }
    const a = pcmFingerprint(build(2, 20))
    const b = pcmFingerprint(build(3, 33))
    const m = bestMatch(a, b, candidateShifts(a, b))!
    expect(Math.abs(m.a.start - 20)).toBeLessThan(1)
    expect(Math.abs(m.b.start - 33)).toBeLessThan(1)
  })

  it('从 ffmpeg 日志读总时长', () => {
    expect(parseDuration('  Duration: 00:45:12.34, start: 0.000')).toBeCloseTo(
      2712.34
    )
    expect(parseDuration('Duration: N/A')).toBeNull()
  })
})

describe('多集投票', () => {
  it('每集和后面两集比', () => {
    expect(pairsFor(4)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
      [2, 3],
    ])
    expect(pairsFor(1)).toEqual([])
    expect(minSupport(2)).toBe(2)
    expect(minSupport(7)).toBe(4)
  })

  it('多数集一致的区间胜出，取中位数；个别集的离群结果不影响', () => {
    const cands = [
      { episode: 0, start: 41, end: 100 },
      { episode: 1, start: 40, end: 101 },
      { episode: 2, start: 42, end: 99 },
      { episode: 3, start: 300, end: 330 },
    ]
    expect(voteSpan(cands, 4)).toEqual({ start: 41, end: 100 })
  })

  it('同一集多次支持只算一票；支持不足返回 null', () => {
    const cands = [
      { episode: 0, start: 40, end: 100 },
      { episode: 0, start: 40, end: 100 },
      { episode: 1, start: 200, end: 260 },
      { episode: 2, start: 400, end: 460 },
    ]
    expect(voteSpan(cands, 3)).toBeNull()
    expect(voteSpan([], 3)).toBeNull()
  })

  it('片尾换算成「离结尾的秒数」后投票', () => {
    // 两集最后 300 秒里，片尾曲分别从 200、210 秒开始（离结尾 100、90 秒）
    const match = { a: { start: 200, end: 280 }, b: { start: 210, end: 290 } }
    const cands = outroCandidates([0, 1], match, [300, 300])
    expect(cands).toEqual([
      { episode: 0, start: 20, end: 100 },
      { episode: 1, start: 10, end: 90 },
    ])
    expect(summarize([], cands, 2, { tolerance: 15 }).outro).toBe(95)
  })

  it('summarize：片头取整，没有结论的项缺省', () => {
    const intro = [
      ...introCandidates([0, 1], {
        a: { start: 40.4, end: 99.6 },
        b: { start: 40.2, end: 99.9 },
      }),
    ]
    expect(summarize(intro, [], 2)).toEqual({ intro: { start: 40, end: 100 } })
    expect(summarize([], [], 2)).toEqual({})
  })

  it('端到端：4 集合成指纹 → 两两比对 → 投票出片头', async () => {
    const eps = [1, 2, 3, 4].map(seed => episode(seed + 40, INTRO, 40))
    const cands: Candidate[] = []
    for (const pair of pairsFor(eps.length)) {
      const m = await compareClips(
        eps[pair[0]],
        eps[pair[1]],
        DEFAULT_MATCH,
        new AbortController().signal
      )
      if (m) cands.push(...introCandidates(pair, m))
    }
    const { intro } = summarize(cands, [], eps.length)
    expect(intro).toBeDefined()
    expect(Math.abs(intro!.start - 40)).toBeLessThanOrEqual(1)
    expect(Math.abs(intro!.end - 100)).toBeLessThanOrEqual(1)
  })
})

describe('并入标记（手动优先）', () => {
  const found = { intro: { start: 42, end: 130 }, outro: 95 }

  it('没有标记时全部采用，来源记为 auto', () => {
    const out = mergeDetected({}, found)
    expect(out.intro).toBe('applied')
    expect(out.outro).toBe('applied')
    expect(out.marks).toEqual({
      intro: { start: 42, end: 130 },
      introSource: 'auto',
      outro: 95,
      outroSource: 'auto',
    })
    expect(mergeSummary(out)).toBe('已检测到片头 0:42 – 2:10，片尾最后 1:35')
  })

  it('手动片头不被覆盖，片尾仍可补上', () => {
    const prev = {
      intro: { start: 10, end: 80 },
      introSource: 'manual' as const,
    }
    const out = mergeDetected(prev, found)
    expect(out.intro).toBe('kept-manual')
    expect(out.outro).toBe('applied')
    expect(out.marks.intro).toEqual({ start: 10, end: 80 })
    expect(out.marks.outro).toBe(95)
    expect(mergeSummary(out)).toContain('手动标记保持不变')
  })

  it('没有来源字段的老记录按手动算', () => {
    const out = mergeDetected(
      { intro: { start: 10, end: 80 }, outro: 60 },
      found
    )
    expect(out.intro).toBe('kept-manual')
    expect(out.outro).toBe('kept-manual')
    expect(mergeSummary(out)).toBe('检测结果与手动标记重叠，手动标记保持不变')
  })

  it('自动结果可以被新的自动结果覆盖', () => {
    const prev = { intro: { start: 0, end: 60 }, introSource: 'auto' as const }
    expect(mergeDetected(prev, found).marks.intro).toEqual(found.intro)
  })

  it('什么都没检测到时保留原标记', () => {
    const prev = { outro: 60, outroSource: 'auto' as const }
    const out = mergeDetected(prev, {})
    expect(out.marks).toEqual(prev)
    expect(mergeSummary(out)).toBe('没有找到各集共同的片头片尾')
  })

  it('手动编辑：改动的项记为手动，没动的保留自动来源', () => {
    const prev = {
      intro: { start: 42, end: 130 },
      introSource: 'auto' as const,
      outro: 95,
      outroSource: 'auto' as const,
    }
    const next = stampManual(prev, {
      intro: { start: 40, end: 130 },
      outro: 95,
    })
    expect(next.introSource).toBe('manual')
    expect(next.outroSource).toBe('auto')
    expect(sourceOf(next, 'intro')).toBe('manual')
    expect(sourceOf({}, 'outro')).toBeNull()
  })

  it('needsDetection：片头或片尾还缺才检测', () => {
    expect(needsDetection({})).toBe(true)
    expect(needsDetection({ intro: { start: 0, end: 60 } })).toBe(true)
    expect(needsDetection({ intro: { start: 0, end: 60 }, outro: 90 })).toBe(
      false
    )
  })

  it('存储带上来源，读回时校验', () => {
    const list = putRecord([], 'c:tv:1', mergeDetected({}, found).marks, 1)
    expect(list[0]).toMatchObject({ introSource: 'auto', outroSource: 'auto' })
    const back = sanitizeSkipRecords([{ ...list[0], outroSource: 'robot' }])
    expect(back[0].introSource).toBe('auto')
    expect(back[0].outroSource).toBeUndefined()
  })
})

describe('skip-store 接入', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('applyDetected 写入自动结果；之后手动改片头不影响片尾来源', async () => {
    const store =
      await import('../src/renderer/src/features/player/skip/skip-store')
    const out = store.applyDetected('c:tv:9', {
      intro: { start: 42, end: 130 },
      outro: 95,
    })
    expect(out.intro).toBe('applied')
    store.setSkipMarks('c:tv:9', {
      ...store.getSkipMarks('c:tv:9'),
      intro: { start: 45, end: 130 },
    })
    expect(store.getSkipMarksWithSource('c:tv:9')).toEqual({
      intro: { start: 45, end: 130 },
      introSource: 'manual',
      outro: 95,
      outroSource: 'auto',
    })
    // 再检测一次：手动片头保留，自动片尾更新
    store.applyDetected('c:tv:9', { intro: { start: 0, end: 90 }, outro: 100 })
    expect(store.getSkipMarks('c:tv:9')).toEqual({
      intro: { start: 45, end: 130 },
      outro: 100,
    })
  })
})

describe('检测队列', () => {
  const request = (key: string): IntroDetectRequest => ({
    key,
    label: key,
    files: ['/a', '/b'],
  })

  it('一次一季、同一季复用、排队中的可取消、进行中的会被中止', async () => {
    const started: string[] = []
    const releases: Record<string, () => void> = {}
    const progress: string[] = []
    const queue = createDetectQueue({
      run: (req, signal) =>
        new Promise(resolve => {
          started.push(req.key)
          releases[req.key] = () => resolve({ key: req.key, success: true })
          signal.addEventListener('abort', () =>
            resolve({ key: req.key, success: false })
          )
        }),
      onProgress: p => progress.push(`${p.key}:${p.phase}`),
    })
    const first = queue.enqueue(request('s1'))
    expect(queue.enqueue(request('s1'))).toBe(first)
    const second = queue.enqueue(request('s2'))
    const third = queue.enqueue(request('s3'))
    await Promise.resolve()
    expect(started).toEqual(['s1'])
    expect(queue.busy()).toBe(true)

    expect(queue.cancel('s2')).toBe(true)
    expect(await second).toEqual({ key: 's2', success: false, cancelled: true })

    releases.s1()
    expect(await first).toEqual({ key: 's1', success: true })
    await vi.waitFor(() => expect(started).toEqual(['s1', 's3']))

    expect(queue.cancel('s3')).toBe(true)
    expect(await third).toEqual({ key: 's3', success: false, cancelled: true })
    expect(queue.cancel('nope')).toBe(false)
    expect(queue.busy()).toBe(false)
    expect(progress).toContain('s1:queued')
    expect(progress).toContain('s1:finished')
  })

  it('检测抛错时返回错误结果，队列继续', async () => {
    const queue = createDetectQueue({
      run: async req => {
        if (req.key === 'bad') throw new Error('炸了')
        return { key: req.key, success: true }
      },
      onProgress: () => {},
    })
    const bad = queue.enqueue(request('bad'))
    const good = queue.enqueue(request('good'))
    expect(await bad).toEqual({ key: 'bad', success: false, error: '炸了' })
    expect(await good).toEqual({ key: 'good', success: true })
  })
})

describe('契约与接入', () => {
  it('detect 入参：至少两集、全是字符串', () => {
    const parse = introDetect.calls.detect.parse
    expect(() => parse([{ key: 'k', label: '', files: ['/a'] }])).toThrow()
    expect(() => parse([{ key: 'k', label: '', files: ['/a', 3] }])).toThrow()
    expect(parse([{ key: 'k', label: 'L', files: ['/a', '/b'] }])).toEqual([
      { key: 'k', label: 'L', files: ['/a', '/b'] },
    ])
  })

  it('设置项 player.autoDetectIntro 默认关闭，设置页可切换', () => {
    expect(settingsSchema['player.autoDetectIntro'].default).toBe(false)
    const page = readFileSync(
      join(
        __dirname,
        '../src/renderer/src/features/settings/sections/PlayerSettings.vue'
      ),
      'utf8'
    )
    expect(page).toContain("useSetting('player.autoDetectIntro')")
  })

  it('剧集详情有「检测片头片尾」，播放器接入自动检测，主进程注册了域', () => {
    const read = (p: string): string =>
      readFileSync(join(__dirname, '..', p), 'utf8')
    const seasons = read(
      'src/renderer/src/features/library/detail/DetailSeasons.vue'
    )
    expect(seasons).toContain('useIntroDetect(')
    expect(seasons).toContain('<UiButton')
    expect(
      read('src/renderer/src/features/player/components/PlayerSession.vue')
    ).toContain(':queue="playlist"')
    expect(
      read('src/renderer/src/features/player/skip/SkipOverlay.vue')
    ).toContain('useAutoIntroDetect(')
    expect(read('src/main/index.ts')).toContain('registerIntroDetectIpc()')
    // 只做本地文件：ffmpeg 输入加 file: 前缀
    expect(read('src/main/intro-detect/ffmpeg.ts')).toContain('`file:${file}`')
  })
})
