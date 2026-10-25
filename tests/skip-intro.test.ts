// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsSchema } from '../src/shared/settings/schema'
import {
  MAX_SKIP_RECORDS,
  type SkipRecord,
  autoSkipStep,
  formatClock,
  hasMarks,
  inOutro,
  introSkipTarget,
  markIntroEnd,
  markIntroStart,
  markOutroStart,
  markSpans,
  outroStartAt,
  putRecord,
  sanitizeSkipRecords,
  skipKey,
} from '../src/renderer/src/features/player/skip/skip-rules'

/**
 * 跳过片头片尾（手动标记）：纯规则、按剧存储，以及播放器接入的源码级约束。
 */

describe('skipKey', () => {
  it('有继续播放记录 id 时用它，否则用片名', () => {
    expect(skipKey('tv:42', '漫长的季节')).toBe('c:tv:42')
    expect(skipKey('', ' 漫长的季节 ')).toBe('t:漫长的季节')
    expect(skipKey('', '  ')).toBe('')
  })
})

describe('标记片头 / 片尾', () => {
  it('标记片头开始：没有结束点时给 90 秒的默认片头', () => {
    expect(markIntroStart({}, 42.7)).toEqual({ intro: { start: 42, end: 132 } })
  })

  it('标记片头开始：保留仍在其后的结束点', () => {
    const marks = { intro: { start: 0, end: 130 } }
    expect(markIntroStart(marks, 42).intro).toEqual({ start: 42, end: 130 })
    // 新开始点在旧结束点之后：旧结束点作废
    expect(markIntroStart(marks, 200).intro).toEqual({ start: 200, end: 290 })
  })

  it('标记片头结束：沿用开始点，没标过开始时从 0 算', () => {
    expect(
      markIntroEnd({ intro: { start: 42, end: 132 } }, 130.4).intro
    ).toEqual({ start: 42, end: 130 })
    expect(markIntroEnd({}, 85).intro).toEqual({ start: 0, end: 85 })
  })

  it('标记片头结束：太短或太长时原样返回（同一个对象）', () => {
    const marks = { intro: { start: 42, end: 132 } }
    expect(markIntroEnd(marks, 44)).toBe(marks)
    expect(markIntroEnd({}, 700)).toEqual({})
  })

  it('标记片尾开始：记离结尾的秒数，不像样时原样返回', () => {
    expect(markOutroStart({}, 2640, 2772)).toEqual({ outro: 132 })
    const marks = {}
    expect(markOutroStart(marks, 2770, 2772)).toBe(marks)
    expect(markOutroStart(marks, 100, 2772)).toBe(marks)
    expect(markOutroStart(marks, 100, Number.NaN)).toBe(marks)
  })
})

describe('播放中判断', () => {
  const marks = { intro: { start: 42, end: 130 }, outro: 120 }

  it('片头里返回跳转目标，片头最后两秒不再提示', () => {
    expect(introSkipTarget(marks, 41)).toBeNull()
    expect(introSkipTarget(marks, 42)).toBe(130)
    expect(introSkipTarget(marks, 127.9)).toBe(130)
    expect(introSkipTarget(marks, 128)).toBeNull()
    expect(introSkipTarget({}, 50)).toBeNull()
  })

  it('片尾按每集时长换算', () => {
    expect(outroStartAt(marks, 2700)).toBe(2580)
    expect(outroStartAt(marks, Number.NaN)).toBeNull()
    expect(inOutro(marks, 2579, 2700)).toBe(false)
    expect(inOutro(marks, 2600, 2700)).toBe(true)
    expect(inOutro(marks, 2700, 2700)).toBe(false)
    expect(inOutro({ intro: marks.intro }, 2600, 2700)).toBe(false)
  })

  it('进度条区间按总时长的比例', () => {
    expect(markSpans(marks, 2000)).toEqual([
      { kind: 'intro', left: 0.021, width: 0.044 },
      { kind: 'outro', left: 0.94, width: 1 - 0.94 },
    ])
    expect(markSpans(marks, 0)).toEqual([])
    expect(markSpans({}, 2000)).toEqual([])
  })

  it('自动跳过：每集只跳一次，越过片头后拖回来不再跳', () => {
    const intro = { intro: { start: 0, end: 90 } }
    const first = autoSkipStep(intro, 3, false)
    expect(first).toEqual({ target: 90, consumed: true })
    // 跳过之后用户拖回片头
    expect(autoSkipStep(intro, 10, first.consumed).target).toBeNull()
    // 续播在片头之后：先看到片头之后的位置就用掉
    const resumed = autoSkipStep(intro, 600, false)
    expect(resumed).toEqual({ target: null, consumed: true })
    expect(autoSkipStep(intro, 10, resumed.consumed).target).toBeNull()
    // 片头之前不跳也不用掉
    const before = { intro: { start: 60, end: 150 } }
    expect(autoSkipStep(before, 10, false)).toEqual({
      target: null,
      consumed: false,
    })
    expect(autoSkipStep({}, 10, false)).toEqual({
      target: null,
      consumed: false,
    })
  })

  it('时间文案', () => {
    expect(formatClock(42)).toBe('0:42')
    expect(formatClock(130.9)).toBe('2:10')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-3)).toBe('0:00')
  })
})

describe('存储记录', () => {
  it('putRecord：新的在前、空标记即删除、超出上限淘汰最旧', () => {
    let list = putRecord([], 'c:a', { intro: { start: 0, end: 90 } }, 1)
    list = putRecord(list, 'c:b', { outro: 60 }, 2)
    expect(list.map(r => r.key)).toEqual(['c:b', 'c:a'])
    list = putRecord(list, 'c:a', { outro: 30 }, 3)
    expect(list[0]).toEqual({ key: 'c:a', updatedAt: 3, outro: 30 })
    expect(putRecord(list, 'c:a', {}, 4).map(r => r.key)).toEqual(['c:b'])
    expect(putRecord(list, '', { outro: 30 }, 4)).toHaveLength(2)

    const many: SkipRecord[] = Array.from(
      { length: MAX_SKIP_RECORDS },
      (_, i) => ({ key: `t:${i}`, updatedAt: i, outro: 30 })
    )
    const next = putRecord(many, 't:new', { outro: 30 }, 999)
    expect(next).toHaveLength(MAX_SKIP_RECORDS)
    expect(next[0].key).toBe('t:new')
    expect(next.at(-1)?.key).toBe(`t:${MAX_SKIP_RECORDS - 2}`)
  })

  it('sanitizeSkipRecords：丢掉坏记录，去掉不像样的单项', () => {
    expect(sanitizeSkipRecords('x')).toEqual([])
    expect(
      sanitizeSkipRecords([
        null,
        { key: '', outro: 30 },
        { key: 'c:a', intro: { start: 0, end: 2 }, outro: 30 },
        { key: 'c:b', intro: { start: 10, end: 100 }, outro: 5000 },
        { key: 'c:c', intro: { start: 'x', end: 100 } },
      ])
    ).toEqual([
      { key: 'c:a', updatedAt: 0, outro: 30 },
      { key: 'c:b', updatedAt: 0, intro: { start: 10, end: 100 } },
    ])
    expect(hasMarks({})).toBe(false)
  })
})

describe('skip-store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  type Store =
    typeof import('../src/renderer/src/features/player/skip/skip-store')
  const loadStore = (): Promise<Store> =>
    import('../src/renderer/src/features/player/skip/skip-store')

  it('写入后持久化到 skip_marks，读回校验过的标记', async () => {
    const store = await loadStore()
    store.setSkipMarks('c:tv:42', { intro: { start: 42, end: 130 } })
    store.setSkipMarks('c:tv:42', {
      ...store.getSkipMarks('c:tv:42'),
      outro: 120,
    })
    expect(store.getSkipMarks('c:tv:42')).toEqual({
      intro: { start: 42, end: 130 },
      outro: 120,
    })
    const saved = JSON.parse(localStorage.getItem('skip_marks') || '[]')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ key: 'c:tv:42', outro: 120 })
    expect(store.getSkipMarks('')).toEqual({})
    expect(store.getSkipMarks('t:别的剧')).toEqual({})
  })

  it('清除本剧标记', async () => {
    const store = await loadStore()
    store.setSkipMarks('t:A', { outro: 60 })
    store.setSkipMarks('t:B', { outro: 60 })
    store.clearSkipMarks('t:A')
    expect(store.skipRecords().value.map(r => r.key)).toEqual(['t:B'])
    expect(store.getSkipMarks('t:A')).toEqual({})
  })

  it('启动时读回存储并丢掉坏数据', async () => {
    localStorage.setItem(
      'skip_marks',
      JSON.stringify([{ key: 't:A', outro: 60, updatedAt: 1 }, { key: 3 }])
    )
    const store = await loadStore()
    expect(store.skipRecords().value).toEqual([
      { key: 't:A', outro: 60, updatedAt: 1 },
    ])
  })

  it('其它窗口改了存储时同步', async () => {
    const store = await loadStore()
    const records = store.skipRecords()
    expect(records.value).toEqual([])
    localStorage.setItem(
      'skip_marks',
      JSON.stringify([{ key: 't:A', outro: 60, updatedAt: 1 }])
    )
    window.dispatchEvent(new StorageEvent('storage', { key: 'skip_marks' }))
    expect(store.getSkipMarks('t:A')).toEqual({ outro: 60 })
  })
})

describe('播放器接入（源码）', () => {
  const root = join(__dirname, '../src/renderer/src')
  const read = (path: string): string => readFileSync(join(root, path), 'utf8')

  it('设置项 player.autoSkipIntro 默认关闭，设置页可切换', () => {
    expect(settingsSchema['player.autoSkipIntro'].default).toBe(false)
    expect(read('features/settings/sections/PlayerSettings.vue')).toContain(
      "useSetting('player.autoSkipIntro')"
    )
  })

  it('UnifiedVideoPlayer 把 Artplayer 实例交给外层，PlayerSession 接上跳过层且不超 400 行', () => {
    expect(read('features/player/components/UnifiedVideoPlayer.vue')).toContain(
      "emit('art', core.art)"
    )
    const session = read('features/player/components/PlayerSession.vue')
    expect(session).toContain('<SkipOverlay')
    expect(session).toContain(':play-next="playNext"')
    expect(session.split('\n').length).toBeLessThanOrEqual(400)
  })

  it('右键菜单四项、跳过层挂进播放器节点、颜色用令牌', () => {
    const composable = read('features/player/skip/use-skip-segments.ts')
    for (const label of [
      '标记片头开始',
      '标记片头结束',
      '标记片尾开始',
      '清除本剧片头片尾',
    ])
      expect(composable).toContain(label)
    expect(composable).toContain('已跳过片头')
    const overlay = read('features/player/skip/SkipOverlay.vue')
    expect(overlay).toContain('<Teleport')
    expect(overlay).not.toMatch(/<button/)
    const tokens = read('assets/styles/tokens.css')
    for (const name of ['--media-intro', '--media-outro', '--glass-media-bg'])
      expect(tokens).toContain(`${name}:`)
    expect(read('features/player/skip/skip.css')).toContain(
      'var(--media-intro)'
    )
  })
})
