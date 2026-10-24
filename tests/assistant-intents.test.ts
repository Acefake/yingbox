/**
 * AI 助手的意图规则：模型输出的严格校验（非法 / 越权 / 未知一律降级为只回答文字）、
 * 按播放状态路由、提示词截断与建议胶囊。
 */
import { describe, expect, it } from 'vitest'

import {
  ASK_CHARS,
  type AssistantContext,
  assistantSuggestions,
  buildIntentMessages,
  parseIntent,
  routeIntent,
} from '../src/renderer/src/features/assistant/assistant-intents'

/** 模型输出：未给的字段按 schema 填空串 / null */
const raw = (fields: Record<string, unknown>): Record<string, unknown> => ({
  action: 'answer',
  reply: '',
  text: '',
  target: '',
  command: '',
  value: null,
  on: null,
  ...fields,
})

const idle: AssistantContext = {
  playing: false,
  controllable: false,
  plotQa: false,
  private: false,
}
const playing: AssistantContext = {
  playing: true,
  controllable: true,
  plotQa: true,
  private: false,
}

describe('parseIntent：合法输出', () => {
  it('推荐、继续播放、搜索、跳转、设置、问剧情', () => {
    expect(
      parseIntent(raw({ action: 'recommend', text: '轻松一点', reply: '好的' }))
    ).toEqual({
      intent: { kind: 'recommend', note: '轻松一点' },
      reply: '好的',
    })
    expect(parseIntent(raw({ action: 'continue' })).intent).toEqual({
      kind: 'continue',
    })
    expect(
      parseIntent(raw({ action: 'search', target: 'tv', text: '韩剧' })).intent
    ).toEqual({ kind: 'search', section: 'tv', query: '韩剧' })
    expect(
      parseIntent(raw({ action: 'navigate', target: 'calendar' })).intent
    ).toEqual({ kind: 'navigate', page: 'calendar' })
    expect(
      parseIntent(raw({ action: 'settings', target: 'ai' })).intent
    ).toEqual({ kind: 'settings', section: 'ai' })
    expect(
      parseIntent(raw({ action: 'plot', text: '他为什么生气' })).intent
    ).toEqual({ kind: 'plot', question: '他为什么生气' })
  })

  it('播放器命令按参数解析，弹幕不透明度接受百分数', () => {
    const cmd = (fields: Record<string, unknown>): unknown =>
      parseIntent(raw({ action: 'player', ...fields })).intent
    expect(cmd({ command: 'danmaku', on: false })).toEqual({
      kind: 'player',
      command: { kind: 'danmaku', on: false },
    })
    expect(cmd({ command: 'danmakuOpacity', value: 50 })).toEqual({
      kind: 'player',
      command: { kind: 'danmakuOpacity', value: 0.5 },
    })
    expect(cmd({ command: 'subtitle', on: true })).toEqual({
      kind: 'player',
      command: { kind: 'subtitle', on: true },
    })
    expect(cmd({ command: 'sleep', target: '30' })).toEqual({
      kind: 'player',
      command: { kind: 'sleep', choice: 30 },
    })
    expect(cmd({ command: 'sleep', target: 'episode' })).toEqual({
      kind: 'player',
      command: { kind: 'sleep', choice: 'episode' },
    })
    expect(cmd({ command: 'skipIntro' })).toEqual({
      kind: 'player',
      command: { kind: 'skipIntro' },
    })
    expect(cmd({ command: 'rate', value: 1.5 })).toEqual({
      kind: 'player',
      command: { kind: 'rate', value: 1.5 },
    })
  })
})

describe('parseIntent：非法 / 越权 / 未知一律只回答文字', () => {
  const answer = { intent: { kind: 'answer' }, reply: '' }

  it('不是对象、未知动作', () => {
    expect(parseIntent(null)).toEqual(answer)
    expect(parseIntent('recommend')).toEqual(answer)
    expect(parseIntent([raw({ action: 'continue' })])).toEqual(answer)
    expect(
      parseIntent(raw({ action: 'deleteLibrary', reply: '已删除' }))
    ).toEqual(answer)
    expect(parseIntent(raw({ action: 'eval', text: 'rm -rf' }))).toEqual(answer)
  })

  it('跳转私密 / 不存在的页面、打开清单外的设置分区', () => {
    for (const target of ['jav', 'av', '/jav', 'http://evil', '../'])
      expect(parseIntent(raw({ action: 'navigate', target })).intent.kind).toBe(
        'answer'
      )
    for (const target of ['lada', 'section-lock', 'download', 'constructor'])
      expect(parseIntent(raw({ action: 'settings', target })).intent.kind).toBe(
        'answer'
      )
  })

  it('参数缺失或越界', () => {
    const kind = (fields: Record<string, unknown>): string =>
      parseIntent(raw(fields)).intent.kind
    expect(kind({ action: 'search', target: 'jav', text: '新片' })).toBe(
      'answer'
    )
    expect(kind({ action: 'search', target: 'movie', text: '' })).toBe('answer')
    expect(kind({ action: 'player', command: 'rate', value: 10 })).toBe(
      'answer'
    )
    expect(kind({ action: 'player', command: 'rate', value: '2' })).toBe(
      'answer'
    )
    expect(kind({ action: 'player', command: 'rate', value: NaN })).toBe(
      'answer'
    )
    expect(kind({ action: 'player', command: 'danmaku', on: 'yes' })).toBe(
      'answer'
    )
    expect(kind({ action: 'player', command: 'sleep', target: '45' })).toBe(
      'answer'
    )
    expect(
      kind({ action: 'player', command: 'danmakuOpacity', value: 0.01 })
    ).toBe('answer')
    expect(kind({ action: 'player', command: 'shutdown' })).toBe('answer')
    expect(kind({ action: 'plot', text: '   ' })).toBe('answer')
  })

  it('只回答文字时丢掉 reply，过长的 reply 截断', () => {
    expect(parseIntent(raw({ action: 'answer', reply: '你好' })).reply).toBe('')
    const long = parseIntent(
      raw({ action: 'continue', reply: '好'.repeat(200) })
    )
    expect([...long.reply]).toHaveLength(60)
  })
})

describe('routeIntent', () => {
  const rate = {
    kind: 'player',
    command: { kind: 'rate', value: 2 },
  } as const

  it('播放器命令：不在播放时给说明，外置播放器时给说明，播放中执行', () => {
    expect(routeIntent(rate, idle).kind).toBe('explain')
    expect(
      routeIntent(rate, { ...playing, controllable: false })
    ).toMatchObject({ kind: 'explain', text: expect.stringContaining('外置') })
    expect(routeIntent(rate, playing)).toEqual({ kind: 'run', intent: rate })
  })

  it('剧情问题：播放中转给问剧情，不支持时说明，不在播放时当普通问题回答', () => {
    const plot = { kind: 'plot', question: '前面讲了什么' } as const
    expect(routeIntent(plot, playing)).toEqual({ kind: 'run', intent: plot })
    expect(routeIntent(plot, { ...playing, plotQa: false }).kind).toBe(
      'explain'
    )
    expect(routeIntent(plot, idle)).toEqual({
      kind: 'run',
      intent: { kind: 'answer' },
    })
  })

  it('其余意图与播放状态无关', () => {
    expect(routeIntent({ kind: 'continue' }, idle).kind).toBe('run')
    expect(routeIntent({ kind: 'continue' }, playing).kind).toBe('run')
  })
})

describe('提示词与建议', () => {
  it('用户输入截到上限，系统提示带播放状态', () => {
    const messages = buildIntentMessages('啊'.repeat(500), playing)
    expect([...messages[1].content]).toHaveLength(ASK_CHARS)
    expect(messages[0].content).toContain('当前正在播放视频')
    expect(buildIntentMessages('你好', idle)[0].content).toContain('没有在播放')
    expect(messages[0].content).not.toMatch(/jav|番号/)
  })

  it('播放中的建议是播放器相关的', () => {
    expect(assistantSuggestions(true)).toContain('关掉弹幕')
    expect(assistantSuggestions(false)).toContain('今晚看什么')
  })
})
