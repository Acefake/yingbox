// test-affected: repo-wide
/**
 * AI 助手居中浮层的纯逻辑与样式约束：上下文胶囊 / 输入示例 / 默认占位（私密模式不出片名也不举例、普通模式无敏感词）、
 * 对话流归档（空问话不记且不换数组、超出上限丢最早的、结果存快照）、贴底滚动（上滚回看时不拉回底部）、
 * 播放器内建议只给有能力支撑的入口；样式约束：没有光圈与光球（令牌、全局样式一起查）、模糊只在遮罩上、
 * 不再有右侧侧栏、唤起时长与令牌一致、居中一列与窄窗口宽度、面板与空闲胶囊同宽、播放器前台时不拦点击、
 * will-change 只在过渡期间、输入胶囊焦点环。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'

vi.mock('@/features/player', () => ({
  askPlotQuestion: vi.fn(),
  runPlayerCommand: vi.fn(),
}))

import { SENSITIVE, idle, playing, privateIdle } from './assistant-fixtures'
import {
  assistantExample,
  assistantPlaceholder,
  assistantSubtitle,
} from '../src/renderer/src/features/assistant/assistant-copy'
import {
  STICK_GAP,
  nearBottom,
  useStickyScroll,
} from '../src/renderer/src/features/assistant/assistant-scroll'
import {
  type ThreadTurn,
  appendTurn,
  hasQuestion,
  snapshotResult,
  useAssistantThread,
} from '../src/renderer/src/features/assistant/assistant-thread'
import { playerSuggestions } from '../src/renderer/src/features/assistant/skills/player-skill'
import type {
  AssistantMediaCard,
  AssistantResult,
} from '../src/renderer/src/features/assistant/skills/skill-types'

const DIR = join(__dirname, '../src/renderer/src/features/assistant')
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8')

const turn = (id: number, question = `问${id}`): ThreadTurn => ({
  id,
  question,
  answer: `答${id}`,
  result: null,
  notice: '',
})

describe('助手文案', () => {
  it('上下文胶囊：在播写片名与时间点，否则写页面名', () => {
    expect(assistantSubtitle(playing)).toBe('正在播放 · 沙丘：第二部 · 1:32:10')
    expect(assistantSubtitle(idle)).toBe('电影 · 当前页面')
    expect(assistantSubtitle({ ...idle, playing: true })).toBe('电影 · 播放中')
  })

  it('私密模式：胶囊只写仅本地模型，不出片名与页面名，也不举例', () => {
    const secret = {
      ...privateIdle,
      nowPlaying: { title: '某片', seconds: 10 },
    }
    expect(assistantSubtitle(secret)).toBe('私密 · 仅本地模型 · 无痕')
    expect(assistantExample(secret)).toBe('')
  })

  it('普通模式的文案没有敏感词', () => {
    for (const context of [idle, playing, { ...playing, plotQa: false }]) {
      expect(assistantSubtitle(context)).not.toMatch(SENSITIVE)
      expect(assistantExample(context)).not.toMatch(SENSITIVE)
      expect(assistantPlaceholder(context)).not.toMatch(SENSITIVE)
    }
  })

  it('能问剧情时占位与示例提到剧情，不能时示例只举播放控制', () => {
    expect(assistantPlaceholder(playing)).toBe('问问正在看的内容…')
    expect(assistantExample(playing)).toBe('例如「刚才发生了什么」')
    const noPlot = { ...playing, plotQa: false }
    expect(assistantPlaceholder(noPlot)).toBe('问影盒…')
    expect(assistantExample(noPlot)).toBe('例如「1.5 倍速」')
    expect(playerSuggestions(noPlot)).toContain('1.5 倍速')
    expect(assistantPlaceholder(idle)).toBe('问影盒…')
    expect(assistantExample(idle)).toMatch(/^例如「.+」$/)
  })
})

describe('对话流归档', () => {
  it('超出上限丢掉最早的；上限不大于 0 时一轮都不留', () => {
    const turns = [turn(1), turn(2), turn(3)]
    expect(appendTurn(turns, turn(4), 3).map(t => t.id)).toEqual([2, 3, 4])
    expect(appendTurn(turns, turn(4), 0)).toEqual([])
    expect(appendTurn(turns, turn(4), -1)).toEqual([])
  })

  it('空问话不归档：数组引用不变，也不占编号', () => {
    const transcript = ref('  ')
    const answer = ref('')
    const result = shallowRef<AssistantResult | null>(null)
    const notice = ref('')
    const thread = useAssistantThread({ transcript, answer, result, notice })
    const before = thread.turns.value
    thread.archive()
    expect(thread.turns.value).toBe(before)
    expect(hasQuestion('  ')).toBe(false)
    transcript.value = '第一句'
    thread.archive()
    expect(thread.turns.value.map(t => t.id)).toEqual([1])
  })

  it('归档的结果是快照：与当前轮不共用对象，之后当前轮怎么变都不影响旧卡片', () => {
    const cards: AssistantMediaCard[] = [
      {
        id: 'a',
        title: '甲',
        playLabel: '播放',
        play: async () => true,
      } as AssistantMediaCard,
    ]
    const current: AssistantResult = { kind: 'cards', cards }
    const transcript = ref('找一部科幻电影')
    const result = shallowRef<AssistantResult | null>(current)
    const thread = useAssistantThread({
      transcript,
      answer: ref('看这个'),
      result,
      notice: ref(''),
    })
    thread.archive()
    const archived = thread.turns.value[0].result
    expect(archived).not.toBe(current)
    cards.push({ ...cards[0], id: 'b' })
    expect(archived?.kind === 'cards' && archived.cards.map(c => c.id)).toEqual(
      ['a']
    )
    expect(snapshotResult(null)).toBeNull()
    const done: AssistantResult = {
      kind: 'done',
      ok: true,
      icon: 'play',
      text: '好了',
    }
    expect(snapshotResult(done)).toEqual(done)
    expect(snapshotResult(done)).not.toBe(done)
  })
})

describe('对话流贴底滚动', () => {
  it('离底部 48px 以内算贴底', () => {
    const box = { scrollHeight: 1000, clientHeight: 400 }
    expect(nearBottom({ ...box, scrollTop: 600 })).toBe(true)
    expect(nearBottom({ ...box, scrollTop: 552 })).toBe(true)
    expect(nearBottom({ ...box, scrollTop: 551 })).toBe(false)
    expect(STICK_GAP).toBe(48)
  })

  it('用户上滚后新内容不拉回底部；回到底部附近或开始新一轮后恢复', async () => {
    const box = { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }
    const sticky = useStickyScroll(ref(box as unknown as HTMLElement))
    // 用户往上翻
    box.scrollTop = 100
    sticky.onScroll()
    box.scrollHeight = 1200
    sticky.follow()
    await nextTick()
    expect(box.scrollTop).toBe(100)
    // 滚回底部附近：恢复跟随
    box.scrollTop = 780
    sticky.onScroll()
    box.scrollHeight = 1400
    sticky.follow()
    await nextTick()
    expect(box.scrollTop).toBe(1400)
    // 再上翻，然后自己提问：强制贴底
    box.scrollTop = 0
    sticky.onScroll()
    sticky.stick()
    await nextTick()
    expect(box.scrollTop).toBe(1400)
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

describe('浮层样式约束', () => {
  const STYLES = join(__dirname, '../src/renderer/src/assets/styles')
  const frame = read('assistant.css')
  const panel = read('assistant-panel.css')
  const css = frame + panel + read('assistant-results.css')
  const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8')
  /** 助手样式 + 令牌 + 全局样式：光圈与光球的残留在哪里都不许有 */
  const everywhere = [
    css,
    tokens,
    readFileSync(join(STYLES, 'global.css'), 'utf8'),
    readFileSync(join(STYLES, 'components.css'), 'utf8'),
  ].join('\n')

  /** 某个选择器的规则体（第一处） */
  const rule = (source: string, selector: string): string => {
    const at = source.indexOf(`${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    return source.slice(at, source.indexOf('}', at))
  }

  it('没有边缘光圈与光球（助手样式、令牌、全局样式都查）', () => {
    expect(everywhere).not.toMatch(/edge-glow|assistant-orb|assistant-glow/)
    expect(everywhere).not.toMatch(/--assistant-ring|--assistant-private-/)
  })

  it('右侧侧栏已经删干净：没有 drawer 选择器与令牌', () => {
    expect(everywhere).not.toMatch(/assistant-drawer/)
    expect(read('AssistantOverlay.vue')).not.toMatch(/drawer/i)
  })

  it('模糊只在遮罩上；面板底色交给 .yb-glass，不自己写 background', () => {
    const blurred = [...css.matchAll(/([^{}]+)\{[^}]*backdrop-filter:\s*blur/g)]
    expect(blurred.length).toBeGreaterThan(0)
    for (const [, selector] of blurred)
      expect(selector.trim()).toMatch(/\.assistant-scrim$/)
    expect(rule(frame, '.assistant-panel')).not.toMatch(/background/)
    expect(
      rule(frame, ".assistant[data-mode='panel'] .assistant-panel")
    ).not.toMatch(/background/)
  })

  it('进出场只动 transform / opacity；每处非零的时长令牌都与 AssistantLauncher 一致，减少动态效果时为 0', () => {
    expect(frame).toMatch(
      /transition:\s*transform var\(--duration-assistant\)[^;]*,\s*opacity var\(--duration-assistant\)/
    )
    const values = [...tokens.matchAll(/--duration-assistant:\s*(\d+)ms/g)].map(
      m => Number(m[1])
    )
    expect(values.length).toBeGreaterThanOrEqual(2)
    const launcher = /OPEN_MS = (\d+)/.exec(read('AssistantLauncher.vue'))
    const nonZero = values.filter(v => v > 0)
    expect(nonZero.length).toBeGreaterThan(0)
    for (const v of nonZero) expect(v).toBe(Number(launcher?.[1]))
    const reduced = tokens.slice(
      tokens.indexOf('@media (prefers-reduced-motion: reduce)')
    )
    expect(reduced).toMatch(/--duration-assistant:\s*0ms/)
  })

  it('居中一列：舞台在正中、不拦点击；列宽取令牌并不超过窗口；面板比空闲胶囊宽出两侧内边距', () => {
    const stage = rule(frame, '.assistant-stage')
    expect(stage).toMatch(/align-items:\s*center/)
    expect(stage).toMatch(/justify-content:\s*center/)
    expect(stage).toMatch(/pointer-events:\s*none/)
    const column = rule(frame, '.assistant-panel')
    expect(column).toMatch(/width:\s*min\(var\(--assistant-width\), 100%\)/)
    expect(column).toMatch(/pointer-events:\s*auto/)
    const open = rule(frame, ".assistant[data-mode='panel'] .assistant-panel")
    expect(open).toMatch(
      /width:\s*min\(calc\(var\(--assistant-width\) \+ var\(--space-4\) \* 2\), 100%\)/
    )
    expect(open).toMatch(/padding:\s*var\(--space-4\) var\(--space-4\)/)
    expect(open).toMatch(
      /max-height:\s*min\(var\(--assistant-panel-height\), 100%\)/
    )
  })

  it('窄窗口（<720px）两侧边距收窄；手机宽度（<520px）不显示快捷键提示', () => {
    const narrow = frame.slice(frame.indexOf('@media (max-width: 719px)'))
    expect(narrow).toMatch(
      /^@media \(max-width: 719px\) \{\s*\.assistant-stage,[^{]*\{\s*padding:\s*var\(--space-3\)/
    )
    const phone = panel.slice(panel.indexOf('@media (max-width: 519px)'))
    expect(rule(phone, '.assistant-keys')).toMatch(/display:\s*none/)
  })

  it('播放器在前台：整层不拦点击', () => {
    expect(rule(frame, ".assistant[data-layout='player']")).toMatch(
      /pointer-events:\s*none/
    )
  })

  it('will-change 只在进出场过渡期间挂上', () => {
    for (const [, selector] of css.matchAll(/([^{}]+)\{[^}]*will-change/g))
      expect(selector).toMatch(/-(enter|leave)-active/)
  })

  it('输入胶囊有可见的焦点描边，且不盖掉玻璃的阴影', () => {
    const focus = rule(panel, '.assistant-field:focus-within')
    expect(focus).toMatch(/outline:\s*1px solid var\(--border-strong\)/)
    expect(focus).not.toMatch(/box-shadow/)
  })
})
