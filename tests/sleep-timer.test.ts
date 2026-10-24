import { describe, expect, it } from 'vitest'

import {
  SLEEP_CHOICES,
  SLEEP_EPISODE_GUARD_MS,
  SLEEP_FADE_MS,
  SLEEP_REATTACH_MS,
  type SleepMedia,
  formatSleepRemaining,
  keepSleepOnAttach,
  sleepChoiceLabel,
  sleepChoiceOf,
  sleepEndsAtVideoEnd,
  sleepFadeFactor,
  sleepRemainingMs,
  sleepStep,
  startSleep,
} from '../src/renderer/src/features/player/sleep/sleep-rules'

const media = (
  currentTime: number,
  duration: number,
  playbackRate = 1
): SleepMedia => ({
  currentTime,
  duration,
  playbackRate,
})

describe('睡眠定时规则', () => {
  it('菜单选项与文案', () => {
    expect(SLEEP_CHOICES.map(sleepChoiceLabel)).toEqual([
      '关',
      '30 分钟',
      '60 分钟',
      '90 分钟',
      '看完本集',
    ])
  })

  it('选中后的状态与反查选中项', () => {
    expect(startSleep('off', 0)).toBeNull()
    expect(startSleep('episode', 0)).toEqual({ mode: 'episode' })
    const s = startSleep(30, 1000)
    expect(s).toEqual({
      mode: 'minutes',
      minutes: 30,
      deadline: 1000 + 1_800_000,
    })
    expect(sleepChoiceOf(s)).toBe(30)
    expect(sleepChoiceOf(null)).toBe('off')
    expect(sleepChoiceOf({ mode: 'episode' })).toBe('episode')
  })

  it('按分钟：剩余时间按挂钟走，不随进度变化', () => {
    const s = startSleep(60, 0)!
    expect(sleepRemainingMs(s, 60_000, media(0, 100))).toBe(3_540_000)
    expect(sleepRemainingMs(s, 9_999_999, media(0, 100))).toBe(0)
  })

  it('看完本集：按倍速换算并扣掉片尾保护，时长未知时不计时', () => {
    const s = { mode: 'episode' as const }
    expect(sleepRemainingMs(s, 0, media(90, 100))).toBe(
      10_000 - SLEEP_EPISODE_GUARD_MS
    )
    expect(sleepRemainingMs(s, 0, media(90, 100, 2))).toBe(
      5_000 - SLEEP_EPISODE_GUARD_MS
    )
    expect(sleepRemainingMs(s, 0, media(100, 100))).toBe(0)
    expect(sleepRemainingMs(s, 0, media(10, Infinity))).toBeNull()
    expect(sleepRemainingMs(s, 0, media(10, Number.NaN))).toBeNull()
  })

  it('渐弱系数：最后 10 秒从 1 线性降到 0', () => {
    expect(SLEEP_FADE_MS).toBe(10_000)
    expect(sleepFadeFactor(20_000)).toBe(1)
    expect(sleepFadeFactor(10_000)).toBe(1)
    expect(sleepFadeFactor(5_000)).toBe(0.5)
    expect(sleepFadeFactor(0)).toBe(0)
    expect(sleepFadeFactor(-5)).toBe(0)
  })

  it('每次检查：未到渐弱区间不动，渐弱区间降音量，到点暂停', () => {
    const s = startSleep(30, 0)!
    const end = 1_800_000
    expect(sleepStep(null, 0, media(0, 100), true)).toEqual({ kind: 'idle' })
    expect(sleepStep(s, end - 20_000, media(0, 100), true)).toEqual({
      kind: 'idle',
    })
    expect(sleepStep(s, end - 2_500, media(0, 100), true)).toEqual({
      kind: 'fade',
      factor: 0.25,
    })
    expect(sleepStep(s, end, media(0, 100), true)).toEqual({ kind: 'stop' })
  })

  it('暂停中不渐弱，但到点仍结束定时', () => {
    const s = startSleep(30, 0)!
    expect(sleepStep(s, 1_800_000 - 2_000, media(0, 100), false)).toEqual({
      kind: 'idle',
    })
    expect(sleepStep(s, 1_800_000, media(0, 100), false)).toEqual({
      kind: 'stop',
    })
  })

  it('看完本集：片尾前暂停，赶在 ended（自动连播）之前', () => {
    const s = { mode: 'episode' as const }
    expect(sleepStep(s, 0, media(99.6, 100), true)).toEqual({ kind: 'stop' })
    expect(sleepStep(s, 0, media(95, 100), true).kind).toBe('fade')
    expect(sleepStep(s, 0, media(10, Infinity), true)).toEqual({ kind: 'idle' })
  })

  it('剩余时间文案', () => {
    expect(formatSleepRemaining(29 * 60_000 + 5_000)).toBe('剩 29:05')
    expect(formatSleepRemaining(3_720_000)).toBe('剩 1:02:00')
    expect(formatSleepRemaining(400)).toBe('剩 0:01')
    expect(formatSleepRemaining(-1)).toBe('剩 0:00')
  })

  it('换集沿用定时，关掉播放器太久再开则作废', () => {
    expect(keepSleepOnAttach(null, 5)).toBe(true)
    expect(keepSleepOnAttach(1000, 1000 + SLEEP_REATTACH_MS)).toBe(true)
    expect(keepSleepOnAttach(1000, 1001 + SLEEP_REATTACH_MS)).toBe(false)
  })

  it('播放结束时：看完本集一定生效，按分钟只在到点后生效', () => {
    expect(sleepEndsAtVideoEnd(null, 0)).toBe(false)
    expect(sleepEndsAtVideoEnd({ mode: 'episode' }, 0)).toBe(true)
    const s = startSleep(30, 0)!
    expect(sleepEndsAtVideoEnd(s, 1_799_999)).toBe(false)
    expect(sleepEndsAtVideoEnd(s, 1_800_000)).toBe(true)
  })
})
