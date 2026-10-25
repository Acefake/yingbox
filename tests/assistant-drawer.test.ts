// test-affected: repo-wide
/**
 * AI 助手侧栏的纯逻辑与样式约束：场景副标题 / 问候说明 / 默认占位（私密模式不出片名、普通模式无敏感词）、
 * 对话流归档（空问话不记、超出上限丢最早的）、播放器内建议只给有能力支撑的入口；
 * 样式里没有背景模糊与边缘光圈，侧栏滑入时长与令牌一致。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/player', () => ({
  askPlotQuestion: vi.fn(),
  runPlayerCommand: vi.fn(),
}))

import { SENSITIVE, idle, playing, privateIdle } from './assistant-fixtures'
import {
  assistantGreetingHint,
  assistantPlaceholder,
  assistantSubtitle,
} from '../src/renderer/src/features/assistant/assistant-copy'
import {
  type ThreadTurn,
  appendTurn,
} from '../src/renderer/src/features/assistant/assistant-thread'
import { playerSuggestions } from '../src/renderer/src/features/assistant/skills/player-skill'

const DIR = join(__dirname, '../src/renderer/src/features/assistant')
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8')

const turn = (id: number, question = `问${id}`): ThreadTurn => ({
  id,
  question,
  answer: `答${id}`,
  result: null,
  notice: '',
})

describe('侧栏文案', () => {
  it('副标题：在播写片名与时间点，否则写页面名', () => {
    expect(assistantSubtitle(playing)).toBe('正在播放 · 沙丘：第二部 · 1:32:10')
    expect(assistantSubtitle(idle)).toBe('电影 · 当前页面')
    expect(assistantSubtitle({ ...idle, playing: true })).toBe('电影 · 播放中')
  })

  it('私密模式：副标题只写仅本地模型，不出片名与页面名', () => {
    const secret = {
      ...privateIdle,
      nowPlaying: { title: '某片', seconds: 10 },
    }
    expect(assistantSubtitle(secret)).toBe('私密 · 仅本地模型 · 无痕')
    expect(assistantGreetingHint(secret)).not.toContain('某片')
  })

  it('普通模式的文案没有敏感词', () => {
    for (const context of [idle, playing, { ...playing, plotQa: false }]) {
      expect(assistantSubtitle(context)).not.toMatch(SENSITIVE)
      expect(assistantGreetingHint(context)).not.toMatch(SENSITIVE)
      expect(assistantPlaceholder(context)).not.toMatch(SENSITIVE)
    }
  })

  it('能问剧情时占位与问候提到剧情，不能时只说播放控制', () => {
    expect(assistantPlaceholder(playing)).toBe('问问正在看的内容…')
    expect(assistantGreetingHint(playing)).toContain('剧情')
    const noPlot = { ...playing, plotQa: false }
    expect(assistantPlaceholder(noPlot)).toBe('问影盒…')
    expect(assistantGreetingHint(noPlot)).not.toContain('剧情')
    expect(assistantPlaceholder(idle)).toBe('问影盒…')
  })
})

describe('对话流归档', () => {
  it('空问话不记', () => {
    expect(appendTurn([turn(1)], turn(2, '  '))).toEqual([turn(1)])
  })

  it('超出上限丢掉最早的', () => {
    const turns = [turn(1), turn(2), turn(3)]
    expect(appendTurn(turns, turn(4), 3).map(t => t.id)).toEqual([2, 3, 4])
  })
})

describe('播放器内建议', () => {
  it('能问剧情：前情提要在前，其余是播放控制', () => {
    expect(playerSuggestions(playing).slice(0, 2)).toEqual([
      '前情提要',
      '刚才发生了什么',
    ])
  })

  it('不能问剧情：只给控制类建议，没有问画面这类没有能力支撑的入口', () => {
    const list = playerSuggestions({ ...playing, plotQa: false })
    expect(list).toEqual(['关掉弹幕', '1.5 倍速', '30 分钟后停止播放'])
    expect(playerSuggestions(playing)).not.toContain('问这个画面')
  })

  it('没在播放时不给', () => {
    expect(playerSuggestions(idle)).toEqual([])
  })
})

describe('侧栏样式约束', () => {
  const css = read('assistant.css') + read('assistant-panel.css')

  it('没有背景模糊与边缘光圈', () => {
    expect(css).not.toMatch(/backdrop-filter/)
    expect(css).not.toMatch(/edge-glow/)
  })

  it('滑入只动 transform / opacity，时长与 AssistantLauncher 一致', () => {
    expect(css).toMatch(
      /transition:\s*transform var\(--duration-assistant-drawer\)[^;]*,\s*opacity var\(--duration-assistant-drawer\)/
    )
    const tokens = readFileSync(
      join(__dirname, '../src/renderer/src/assets/styles/tokens.css'),
      'utf8'
    )
    const ms = /--duration-assistant-drawer:\s*(\d+)ms/.exec(tokens)?.[1]
    expect(read('AssistantLauncher.vue')).toContain(`DRAWER_MS = ${ms}`)
  })

  it('窄窗口下侧栏占满宽度（减去两侧边距）', () => {
    expect(css).toMatch(/@media \(max-width: 719px\)/)
  })
})
