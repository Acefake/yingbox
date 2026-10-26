/**
 * AI 助手内置技能包的执行器与隐私：继续播放的卡片（私密板块的记录不出现）、搜索与跳转的路由、
 * 播放器命令、问剧情转交；私密模式下模型请求带 private + localOnly，语音只允许本地识别；
 * 上下文带当前页面与在播片名 / 时间点。媒体库、播放器、AI 模块都换成替身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const fakes = vi.hoisted(() => ({
  records: [] as unknown[],
  remote: {
    playing: false,
    controllable: false,
    plotQa: false,
    private: false,
  },
  now: null as null | { title: string; seconds: number; private: boolean },
  speech: 'off',
  chatJson: vi.fn(),
  chatStream: vi.fn(),
  runPlayerCommand: vi.fn(),
  askPlotQuestion: vi.fn(),
  openMediaPlayer: vi.fn(async () => true),
}))

vi.mock('@/features/library', () => ({ libraryCardInfo: async () => null }))

vi.mock('@/features/player', () => ({
  askPlotQuestion: fakes.askPlotQuestion,
  continueRecords: () => ref(fakes.records),
  metaOf: (r: { id: string }) => ({ id: r.id }),
  openMediaPlayer: fakes.openMediaPlayer,
  playerRemoteState: () => fakes.remote,
  playerNowPlaying: () => fakes.now,
  progressRatio: (r: { progress: number; duration: number }) =>
    r.progress / r.duration,
  replayOptions: (r: { id: string }) => ({ url: r.id, startAt: 0, title: '' }),
  runPlayerCommand: fakes.runPlayerCommand,
}))

vi.mock('@/features/ai', () => ({
  AiCallError: class extends Error {},
  aiAvailable: () => true,
  aiConfigured: () => true,
  aiKeyConfigured: () => true,
  chatJson: fakes.chatJson,
  chatStream: fakes.chatStream,
}))

vi.mock('../src/renderer/src/features/assistant/assistant-voice', () => ({
  voiceSupported: () => true,
  startVoice: vi.fn(),
  transcribeVoice: vi.fn(),
}))

vi.mock('@/features/settings', () => ({
  getSetting: (key: string) => (key === 'ai.speech.engine' ? fakes.speech : ''),
}))

import { raw } from './assistant-fixtures'
import { routes } from '../src/renderer/src/router/routers'
import {
  assistantContext,
  assistantVoiceReady,
  createAssistantDeps,
  privacyFields,
} from '../src/renderer/src/features/assistant/assistant-deps'
import { registerCoreSkills } from '../src/renderer/src/features/assistant/skills/core-skills'
import { parseIntent } from '../src/renderer/src/features/assistant/skills/skill-prompt'
import { createSkillRegistry } from '../src/renderer/src/features/assistant/skills/skill-registry'
import type {
  ActionOutcome,
  AssistantMediaCard,
} from '../src/renderer/src/features/assistant/skills/skill-types'

const record = (id: string, section: string): Record<string, unknown> => ({
  id,
  section,
  key: id,
  title: `片 ${id}`,
  replay: {},
  progress: 30 * 60,
  duration: 60 * 60,
  updatedAt: 0,
})

const registry = createSkillRegistry()
registerCoreSkills(registry, routes)
const skills = registry.list()
const signal = new AbortController().signal
const router = { push: vi.fn(async () => {}) }
const openSettings = vi.fn()

/** 按模型输出执行一个动作（经严格校验） */
async function run(fields: Record<string, unknown>): Promise<ActionOutcome> {
  const { intent } = parseIntent(raw(fields), skills)
  if (intent.kind !== 'action') throw new Error('没有解析成动作')
  return intent.action.run(intent.params, {
    router: router as never,
    openSettings,
    signal,
  })
}

/** 取结果里的卡片 */
function cardsOf(outcome: ActionOutcome): AssistantMediaCard[] {
  if (outcome.result?.kind !== 'cards') throw new Error('kind')
  return outcome.result.cards
}

beforeEach(() => {
  vi.clearAllMocks()
  fakes.records = []
  fakes.now = null
  fakes.speech = 'off'
  fakes.remote = {
    playing: false,
    controllable: false,
    plotQa: false,
    private: false,
  }
})

describe('继续播放', () => {
  it('继续播放：私密路由的板块记录不出现，最多 3 张，带进度', async () => {
    fakes.records = [
      record('a', 'jav'),
      record('b', 'movie'),
      record('c', 'av'),
      record('d', 'tv'),
      record('e', 'online'),
      record('f', 'movie'),
    ]
    const cards = cardsOf(await run({ action: 'library.continue' }))
    expect(cards.map(c => c.id)).toEqual(['b', 'd', 'e'])
    expect(cards[0].progress).toBeCloseTo(0.5)
    expect(cards[0].progressNote).toBe('剩 30 分钟')
    expect(cards[0].library).toBeUndefined()
    await cards[0].play()
    expect(fakes.openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'b', continueAs: { id: 'b' } })
    )
  })
})

describe('搜索、跳转与设置', () => {
  it('搜索跳到媒体库并强制走自然语言解析，收起助手', async () => {
    const outcome = await run({
      action: 'library.search',
      target: 'movie',
      text: '90 年代港片',
    })
    expect(router.push).toHaveBeenCalledWith({
      path: '/movie',
      query: { q: '?90 年代港片' },
    })
    expect(outcome.close).toBe(true)
  })

  it('跳转页面与打开设置分区', async () => {
    await run({ action: 'navigation.navigate', target: 'calendar' })
    expect(router.push).toHaveBeenCalledWith('/calendar')
    const outcome = await run({ action: 'navigation.settings', target: 'ai' })
    expect(openSettings).toHaveBeenCalledWith('ai')
    expect(outcome.close).toBe(true)
  })
})

describe('播放器与问剧情', () => {
  it('播放器命令交给遥控，回执只放结果卡片；失败时标成失败', async () => {
    fakes.runPlayerCommand.mockReturnValue({ ok: true, text: '已切到 2 倍速' })
    const outcome = await run({
      action: 'player.control',
      command: 'rate',
      value: 2,
    })
    expect(fakes.runPlayerCommand).toHaveBeenCalledWith({
      kind: 'rate',
      value: 2,
    })
    expect(outcome.result).toEqual({
      kind: 'done',
      ok: true,
      icon: 'play',
      text: '已切到 2 倍速',
    })
    // 回执只在结果卡片里，不再逐字重复
    expect(outcome.message).toBe('')
    fakes.runPlayerCommand.mockReturnValue({ ok: false, text: '不行' })
    expect(
      (await run({ action: 'player.control', command: 'skipIntro' })).result
    ).toMatchObject({ ok: false, icon: 'info' })
  })

  it('问剧情：转交成功收起助手，失败给说明', async () => {
    fakes.askPlotQuestion.mockReturnValue(true)
    expect((await run({ action: 'player.plot', text: '他是谁' })).close).toBe(
      true
    )
    fakes.askPlotQuestion.mockReturnValue(false)
    const outcome = await run({ action: 'player.plot', text: '他是谁' })
    expect(outcome.close).toBeUndefined()
    expect(outcome.message).toContain('不能问剧情')
  })
})

describe('上下文与隐私', () => {
  const route = (adultOnly: boolean): never =>
    ({ path: '/movie', meta: { adultOnly, title: '电影' } }) as never

  it('上下文：页面名、在播片名与时间点；私密路由或私密播放为私密', () => {
    expect(assistantContext(route(false))).toMatchObject({
      route: { path: '/movie', title: '电影' },
      private: false,
      nowPlaying: null,
    })
    expect(assistantContext(route(true)).private).toBe(true)
    fakes.remote = {
      playing: true,
      controllable: true,
      plotQa: false,
      private: true,
    }
    fakes.now = { title: '某片', seconds: 75, private: true }
    expect(assistantContext(route(false))).toMatchObject({
      playing: true,
      private: true,
      nowPlaying: { title: '某片', seconds: 75 },
    })
  })

  it('私密模式：归意图与回答都带 private + localOnly（强制本地模型）', async () => {
    expect(privacyFields({ private: false })).toEqual({})
    fakes.chatJson.mockResolvedValue({
      data: raw({ action: 'library.continue' }),
    })
    const deps = createAssistantDeps({
      router: {} as never,
      route: route(true),
      registry,
      close: vi.fn(),
      reducedMotion: () => true,
    })
    expect(deps.revealMs?.()).toBe(0)
    const context = deps.context()
    await deps.classify('继续', context, registry.active(context), signal)
    expect(fakes.chatJson.mock.calls[0][0]).toMatchObject({
      private: true,
      localOnly: true,
    })
    await deps.stream('你好', context, vi.fn(), signal)
    expect(fakes.chatStream.mock.calls[0][0]).toMatchObject({
      private: true,
      localOnly: true,
    })
  })

  it('普通模式请求不带隐私字段；schema 的动作来自生效技能', async () => {
    fakes.chatJson.mockResolvedValue({
      data: raw({ action: 'library.continue' }),
    })
    const deps = createAssistantDeps({
      router: {} as never,
      route: route(false),
      registry,
      close: vi.fn(),
      reducedMotion: () => false,
    })
    const context = deps.context()
    const parsed = await deps.classify(
      '继续',
      context,
      registry.active(context),
      signal
    )
    expect(parsed.intent).toMatchObject({ id: 'library.continue' })
    const request = fakes.chatJson.mock.calls[0][0]
    expect(request.private).toBeUndefined()
    expect(request.localOnly).toBeUndefined()
    expect(request.schema.properties.action.enum).toContain('library.continue')
  })

  it('语音：识别关闭时不可用；私密模式只允许本地识别', () => {
    expect(assistantVoiceReady(false)).toBe(false)
    fakes.speech = 'cloud'
    expect(assistantVoiceReady(false)).toBe(true)
    expect(assistantVoiceReady(true)).toBe(false)
    fakes.speech = 'local-whisper'
    expect(assistantVoiceReady(true)).toBe(true)
  })
})
