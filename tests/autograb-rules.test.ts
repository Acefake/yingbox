import { describe, expect, it } from 'vitest'

import {
  FOREVER,
  type Gate,
  type GateState,
  TRIP_PAUSE_MS,
  createGate,
  emptyGate,
} from '../src/main/autograb/gate'
import {
  type FileMatch,
  excludedWord,
  folderWorthOpening,
  matchFile,
  seasonIn,
  titleMatches,
} from '../src/main/autograb/match-rules'
import {
  isDue,
  nextTry,
  searchStart,
} from '../src/main/autograb/schedule-rules'
import { parseState } from '../src/main/autograb/state'
import { Pan115Error } from '../src/main/pan115/errors'

const GB = 1024 ** 3
const target = { seriesTitle: '繁花', season: 1, episode: 5 }
const ctx = { shareTitle: '繁花 4K 更新至05集', folder: '' }

describe('追更 · 认文件', () => {
  it('认出同一集并打分', () => {
    const m = matchFile(
      { name: '繁花.第05集.2160p.WEB-DL.mkv', size: 2 * GB, isDir: false },
      target,
      ctx
    )
    expect(m.ok).toBe(true)
    if (m.ok) {
      expect(m.score).toBeGreaterThanOrEqual(70)
      expect(m.reasons).toContain('4K')
    }
  })

  it('集号不对、太小、预告、多集都拒绝', () => {
    const file = (name: string, size = GB): FileMatch =>
      matchFile({ name, size, isDir: false }, target, ctx)
    expect(file('繁花.第06集.mkv').ok).toBe(false)
    expect(file('繁花.第05集.mkv', 10 * 1024 * 1024).ok).toBe(false)
    expect(file('繁花.第05集.预告.mkv').ok).toBe(false)
    expect(file('繁花.第05-06集.mkv').ok).toBe(false)
    expect(file('繁花.第05集.txt').ok).toBe(false)
  })

  it('季号：写明的必须相同，没写时只接受第 1 季', () => {
    const t2 = { seriesTitle: 'Severance', season: 2, episode: 5 }
    const ok = matchFile(
      { name: 'Severance.S02E05.1080p.mkv', size: GB, isDir: false },
      t2,
      { shareTitle: '', folder: '' }
    )
    expect(ok.ok).toBe(true)
    const wrong = matchFile(
      { name: 'Severance.S01E05.1080p.mkv', size: GB, isDir: false },
      t2,
      { shareTitle: '', folder: '' }
    )
    expect(wrong.ok).toBe(false)
    const bare = matchFile(
      { name: 'Severance.E05.mkv', size: GB, isDir: false },
      t2,
      { shareTitle: '', folder: '' }
    )
    expect(bare.ok).toBe(false)
    const fromFolder = matchFile(
      { name: 'E05.mkv', size: GB, isDir: false },
      t2,
      { shareTitle: 'Severance', folder: '第二季' }
    )
    expect(fromFolder.ok).toBe(true)
  })

  it('剧名对不上拒绝', () => {
    const m = matchFile(
      { name: '人世间.第05集.mkv', size: GB, isDir: false },
      target,
      { shareTitle: '人世间', folder: '' }
    )
    expect(m.ok).toBe(false)
  })

  it('辅助规则', () => {
    expect(titleMatches('The Last of Us', 'the.last.of.us')).toBe(true)
    expect(titleMatches('繁', '繁花')).toBe(false)
    expect(seasonIn('庆余年第二季')).toBe(2)
    expect(seasonIn('Show S03 1080p')).toBe(3)
    expect(excludedWord('Show.E05.CAM.mkv')).toBe('CAM')
    expect(excludedWord('Scamp.E05.mkv')).toBeNull()
    expect(folderWorthOpening('第一季', target)).toBe(true)
    expect(folderWorthOpening('第二季', target)).toBe(false)
  })
})

describe('追更 · 搜索时间', () => {
  it('播出日 20 点开始，前 48 小时每 4 小时，之后每天，14 天后放弃', () => {
    const start = searchStart('2026-10-20')
    expect(new Date(start).getHours()).toBe(20)
    expect(isDue('2026-10-20', start, start - 1)).toBe(false)
    expect(isDue('2026-10-20', start, start)).toBe(true)
    expect(nextTry('2026-10-20', start)).toBe(start + 4 * 3_600_000)
    const late = start + 3 * 24 * 3_600_000
    expect(nextTry('2026-10-20', late)).toBe(late + 24 * 3_600_000)
    expect(nextTry('2026-10-20', start + 14 * 24 * 3_600_000)).toBeNull()
  })
})

describe('追更 · 115 闸门', () => {
  const make = (
    now = { t: 1_000_000 }
  ): { state: GateState; gate: Gate; now: { t: number } } => {
    const state = emptyGate(now.t)
    const gate = createGate(
      state,
      {
        now: () => now.t,
        sleep: async ms => void (now.t += ms),
        random: () => 0,
        maxReceives: 2,
      },
      () => {}
    )
    return { state, gate, now }
  }

  it('串行且有间隔、按天限额', async () => {
    const { gate, now, state } = make()
    const start = now.t
    await gate.run('receive', async () => 1)
    await gate.run('receive', async () => 2)
    expect(now.t - start).toBeGreaterThanOrEqual(3000)
    await expect(gate.run('receive', async () => 3)).rejects.toThrow(
      '转存次数已用完'
    )
    expect(state.receives).toBe(2)
  })

  it('风控熔断 6 小时，48 小时内第二次停到手动恢复', async () => {
    const { gate, now, state } = make()
    const risk = (): Promise<unknown> =>
      gate.run('snap', async () => {
        throw new Pan115Error('需要验证', 911)
      })
    await expect(risk()).rejects.toThrow()
    expect(state.pausedUntil).toBe(now.t + TRIP_PAUSE_MS)
    expect(gate.paused()).toBe(true)
    now.t += TRIP_PAUSE_MS + 1
    expect(gate.paused()).toBe(false)
    await expect(risk()).rejects.toThrow()
    expect(state.pausedUntil).toBe(FOREVER)
    gate.resume()
    expect(gate.paused()).toBe(false)
  })

  it('登录失效停到重新登录', async () => {
    const { gate, state } = make()
    await expect(
      gate.run('snap', async () => {
        throw new Pan115Error('x', 99)
      })
    ).rejects.toThrow()
    expect(state.loginPause).toBe(true)
    await expect(gate.run('snap', async () => 1)).rejects.toThrow('登录')
  })
})

describe('追更 · 状态文件', () => {
  it('坏数据丢掉，好数据保留', () => {
    const state = parseState(
      {
        version: 1,
        enabled: false,
        series: {
          '12': { mode: 'auto', cid: '99', title: 'A' },
          bad: {},
          '13': { mode: 'nope' },
        },
        episodes: {
          '12:1:1': { status: 'found', airDate: '2026-10-01', seriesId: 12 },
          x: { status: '??' },
        },
        blacklist: { old: 1, live: Number.MAX_SAFE_INTEGER },
      },
      1000
    )
    expect(state.enabled).toBe(false)
    expect(Object.keys(state.series)).toEqual(['12', '13'])
    // 认不出的方式：跟随全局（老文件的全局是不追，等价于不追）
    expect(state.series['13'].mode).toBe('inherit')
    expect(state.policy.mode).toBe('off')
    expect(Object.keys(state.episodes)).toEqual(['12:1:1'])
    expect(Object.keys(state.blacklist)).toEqual(['live'])
  })
})
