/**
 * AI 助手的动作路由与隐私：推荐 / 继续播放的卡片（私密板块的记录不出现）、搜索与跳转的路由、
 * 播放器命令（播放中 vs 不在播放）、问剧情转交；模型请求在私密板块 / 私密播放时带 private。
 * 媒体库、播放器、AI 模块都换成替身。
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
  chatJson: vi.fn(),
  chatStream: vi.fn(),
  runPlayerCommand: vi.fn(),
  askPlotQuestion: vi.fn(),
  openMediaPlayer: vi.fn(async () => true),
  suggestTonight: vi.fn(),
  playTonightPick: vi.fn(async () => true),
}))

vi.mock('@/features/library', () => ({
  suggestTonight: fakes.suggestTonight,
  playTonightPick: fakes.playTonightPick,
}))

vi.mock('@/features/player', () => ({
  askPlotQuestion: fakes.askPlotQuestion,
  continueRecords: () => ref(fakes.records),
  metaOf: (r: { id: string }) => ({ id: r.id }),
  openMediaPlayer: fakes.openMediaPlayer,
  playerRemoteState: () => fakes.remote,
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

vi.mock('@/features/settings', () => ({
  getSetting: (key: string) => (key === 'ai.speech.engine' ? 'off' : ''),
}))

import {
  createAssistantActions,
  visibleContinueRecords,
} from '../src/renderer/src/features/assistant/assistant-actions'
import {
  assistantContext,
  createAssistantDeps,
} from '../src/renderer/src/features/assistant/assistant-deps'

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

function setup(): {
  router: { push: ReturnType<typeof vi.fn> }
  openSettings: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof createAssistantActions>
} {
  const router = { push: vi.fn(async () => {}) }
  const openSettings = vi.fn()
  const execute = createAssistantActions({
    router: router as never,
    openSettings,
  })
  return { router, openSettings, execute }
}

const signal = new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
  fakes.records = []
  fakes.remote = {
    playing: false,
    controllable: false,
    plotQa: false,
    private: false,
  }
})

describe('推荐与继续播放', () => {
  it('推荐：今晚看什么的结果变成海报卡片，点击播放', async () => {
    const pick = { candidate: { id: 7 } }
    fakes.suggestTonight.mockResolvedValue({
      suggestions: [
        {
          pick,
          title: '花样年华',
          image: 'poster.jpg',
          meta: '98 分钟',
          reason: '安静的晚上',
          resume: true,
        },
      ],
      notice: null,
    })
    const { execute } = setup()
    const outcome = await execute({ kind: 'recommend', note: '安静' }, signal)
    expect(fakes.suggestTonight).toHaveBeenCalledWith('安静', signal)
    expect(outcome.result).toMatchObject({
      kind: 'picks',
      cards: [{ id: '7', title: '花样年华', playLabel: '继续播放' }],
    })
    if (outcome.result?.kind !== 'picks') throw new Error('kind')
    await outcome.result.cards[0].play()
    expect(fakes.playTonightPick).toHaveBeenCalledWith(pick)
  })

  it('推荐不到时只给说明', async () => {
    fakes.suggestTonight.mockResolvedValue({ suggestions: [], notice: null })
    const { execute } = setup()
    const outcome = await execute({ kind: 'recommend', note: '' }, signal)
    expect(outcome.result).toBeNull()
    expect(outcome.message).toContain('挑不出')
  })

  it('继续播放：私密板块（番号 / AV）的记录不出现，最多 3 张，带进度', async () => {
    fakes.records = [
      record('a', 'jav'),
      record('b', 'movie'),
      record('c', 'av'),
      record('d', 'tv'),
      record('e', 'online'),
      record('f', 'movie'),
    ]
    const { execute } = setup()
    const outcome = await execute({ kind: 'continue' }, signal)
    if (outcome.result?.kind !== 'continue') throw new Error('kind')
    expect(outcome.result.cards.map(c => c.id)).toEqual(['b', 'd', 'e'])
    expect(outcome.result.cards[0].progress).toBeCloseTo(0.5)
    expect(outcome.result.cards[0].meta).toBe('剩 30 分钟')
    await outcome.result.cards[0].play()
    expect(fakes.openMediaPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'b', continueAs: { id: 'b' } })
    )
    expect(visibleContinueRecords([record('x', 'jav')] as never)).toEqual([])
  })
})

describe('搜索、跳转与设置', () => {
  it('搜索跳到媒体库并强制走自然语言解析，收起助手', async () => {
    const { execute, router } = setup()
    const outcome = await execute(
      { kind: 'search', section: 'movie', query: '90 年代港片' },
      signal
    )
    expect(router.push).toHaveBeenCalledWith({
      path: '/movie',
      query: { q: '?90 年代港片' },
    })
    expect(outcome.close).toBe(true)
  })

  it('跳转页面与打开设置分区', async () => {
    const { execute, router, openSettings } = setup()
    await execute({ kind: 'navigate', page: 'calendar' }, signal)
    expect(router.push).toHaveBeenCalledWith('/calendar')
    const outcome = await execute({ kind: 'settings', section: 'ai' }, signal)
    expect(openSettings).toHaveBeenCalledWith('ai')
    expect(outcome.close).toBe(true)
  })
})

describe('播放器与问剧情', () => {
  it('播放器命令交给遥控，回执带结果', async () => {
    fakes.runPlayerCommand.mockReturnValue({ ok: true, text: '已切到 2 倍速' })
    const { execute } = setup()
    const outcome = await execute(
      { kind: 'player', command: { kind: 'rate', value: 2 } },
      signal
    )
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
  })

  it('遥控失败时回执标成失败', async () => {
    fakes.runPlayerCommand.mockReturnValue({
      ok: false,
      text: '现在没有正在播放的视频',
    })
    const { execute } = setup()
    const outcome = await execute(
      { kind: 'player', command: { kind: 'skipIntro' } },
      signal
    )
    expect(outcome.result).toMatchObject({
      kind: 'done',
      ok: false,
      icon: 'info',
    })
  })

  it('问剧情：转交成功收起助手，失败给说明', async () => {
    const { execute } = setup()
    fakes.askPlotQuestion.mockReturnValue(true)
    expect(
      (await execute({ kind: 'plot', question: '他是谁' }, signal)).close
    ).toBe(true)
    fakes.askPlotQuestion.mockReturnValue(false)
    const outcome = await execute({ kind: 'plot', question: '他是谁' }, signal)
    expect(outcome.close).toBeUndefined()
    expect(outcome.message).toContain('不能问剧情')
  })
})

describe('隐私：模型请求的 private 标记', () => {
  const route = (adultOnly: boolean): never =>
    ({ meta: { adultOnly } }) as never

  it('成人板块或在播私密内容时为私密', () => {
    expect(assistantContext(route(false)).private).toBe(false)
    expect(assistantContext(route(true)).private).toBe(true)
    fakes.remote = { ...fakes.remote, playing: true, private: true }
    expect(assistantContext(route(false))).toMatchObject({
      playing: true,
      private: true,
    })
  })

  it('归意图与回答都把 private 交给模型调用；语音识别关闭时不提供麦克风', async () => {
    fakes.chatJson.mockResolvedValue({ data: { action: 'continue' } })
    const deps = createAssistantDeps({
      router: {} as never,
      route: route(true),
      close: vi.fn(),
      reducedMotion: () => true,
    })
    expect(deps.voice).toBeNull()
    expect(deps.revealMs?.()).toBe(0)
    const context = deps.context()
    const parsed = await deps.classify('继续', context, signal)
    expect(parsed.intent).toEqual({ kind: 'continue' })
    expect(fakes.chatJson.mock.calls[0][0]).toMatchObject({ private: true })
    await deps.stream('你好', context, vi.fn(), signal)
    expect(fakes.chatStream.mock.calls[0][0]).toMatchObject({ private: true })
  })
})
