/**
 * AI 助手的私密技能：只在开关打开时动态加载并登记、关闭时卸载并清空对话上下文；
 * 对话上下文只在内存里，私密 / 普通切换时清空；私密技能包的番号规整与各动作的执行。
 * 媒体库、播放器、去码任务换成替身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const fakes = vi.hoisted(() => ({
  records: [] as unknown[],
  find: vi.fn(),
  random: vi.fn(),
  video: vi.fn(),
  playItem: vi.fn(async () => true),
  startLive: vi.fn(async () => {}),
}))

vi.mock('@/features/player', async () => {
  const { shallowRef } = await import('vue')
  return {
    continueRecords: () => shallowRef(fakes.records),
    metaOf: vi.fn(),
    openMediaPlayer: vi.fn(),
    progressRatio: () => 0.25,
    replayOptions: vi.fn(),
  }
})

vi.mock('@/features/library', () => ({
  findLibraryItems: fakes.find,
  randomLibraryItem: fakes.random,
  libraryItemVideo: fakes.video,
  libraryPoster: (url: string | null) => url,
  playLibraryItem: fakes.playItem,
}))

vi.mock('@/features/lada', () => ({
  useLadaTasks: () => ({ startLive: fakes.startLive }),
}))

vi.mock('@/features/assistant', async () => ({
  ...(await import('../src/renderer/src/features/assistant/skills/skill-types')),
  ...(await import('../src/renderer/src/features/assistant/skills/continue-cards')),
  privateRouteSections: (
    await import('../src/renderer/src/features/assistant/skills/core-skills')
  ).privateRouteSections,
}))

import { idle, privateIdle, raw } from './assistant-fixtures'
import {
  assistantHistory,
  assistantSessionSize,
  clearAssistantSession,
  recordAssistantTurn,
} from '../src/renderer/src/features/assistant/assistant-session'
import { installPrivateSkills } from '../src/renderer/src/features/assistant/private-skills'
import { parseIntent } from '../src/renderer/src/features/assistant/skills/skill-prompt'
import { createSkillRegistry } from '../src/renderer/src/features/assistant/skills/skill-registry'
import type { ActionOutcome } from '../src/renderer/src/features/assistant/skills/skill-types'
import privateSkill from '../src/renderer/src/features/av/assistant'
import {
  exactCodeMatch,
  normalizeCode,
} from '../src/renderer/src/features/av/assistant/av-skill-rules'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  fakes.records = []
  clearAssistantSession()
})

describe('私密技能的加载与卸载', () => {
  it('开关关闭时不加载；打开时动态加载并登记；关闭时卸载并清空上下文', async () => {
    const enabled = ref(false)
    const registry = createSkillRegistry()
    const load = vi.fn(async () => ({ default: privateSkill }))
    const stop = installPrivateSkills({
      enabled: () => enabled.value,
      load,
      registry,
    })
    await flush()
    expect(load).not.toHaveBeenCalled()
    expect(registry.list()).toEqual([])

    enabled.value = true
    await flush()
    expect(load).toHaveBeenCalledOnce()
    expect(registry.has('private')).toBe(true)
    expect(registry.active(idle)).toEqual([])
    expect(registry.active(privateIdle).map(s => s.id)).toEqual(['private'])

    recordAssistantTurn('按番号搜', '好的', true)
    enabled.value = false
    await flush()
    expect(registry.has('private')).toBe(false)
    expect(assistantSessionSize()).toBe(0)
    stop()
  })

  it('加载途中关掉开关：加载完也不登记', async () => {
    const enabled = ref(true)
    const registry = createSkillRegistry()
    let finish!: () => void
    const gate = new Promise<void>(resolve => (finish = resolve))
    installPrivateSkills({
      enabled: () => enabled.value,
      load: async () => {
        await gate
        return { default: privateSkill }
      },
      registry,
    })
    enabled.value = false
    await flush()
    finish()
    await flush()
    expect(registry.has('private')).toBe(false)
  })
})

describe('对话上下文（只在内存里）', () => {
  it('最多带 4 轮；私密与普通之间切换时清空', () => {
    for (let i = 0; i < 6; i++) recordAssistantTurn(`问${i}`, `答${i}`, false)
    expect(assistantSessionSize()).toBe(4)
    expect(assistantHistory(false)[0]).toEqual({ role: 'user', content: '问2' })
    recordAssistantTurn('私密的问题', '私密的回答', true)
    expect(assistantSessionSize()).toBe(1)
    expect(assistantHistory(false)).toEqual([])
    expect(assistantSessionSize()).toBe(0)
  })
})

describe('私密技能包', () => {
  /** 私密板块来自路由表的 meta.adultOnly（父路由上的也算） */
  const routeTable = [
    { path: '/movie', meta: { title: '电影' } },
    { path: '/jav', meta: { title: '番号', adultOnly: true } },
    { path: '/av', meta: { title: 'AV资源' } },
  ]
  const router = {
    push: vi.fn(async () => {}),
    currentRoute: { value: { path: '/jav', query: { item: '42' } } },
    getRoutes: () => routeTable,
    resolve: (path: string) => {
      const record = routeTable.find(r => r.path === path)!
      // 模拟 /av 的 adultOnly 挂在父路由上：只有 resolve 合并后才看得到
      return path === '/av'
        ? { ...record, meta: { ...record.meta, adultOnly: true } }
        : record
    },
  }
  const signal = new AbortController().signal
  const skills = [privateSkill]

  async function run(fields: Record<string, unknown>): Promise<ActionOutcome> {
    const { intent } = parseIntent(raw(fields), skills)
    if (intent.kind !== 'action') throw new Error('没有解析成动作')
    return intent.action.run(intent.params, {
      router: router as never,
      openSettings: vi.fn(),
      signal,
    })
  }

  it('番号规整：大小写、分隔符、前导零与两段前缀', () => {
    expect(normalizeCode('abc123')).toBe('ABC-123')
    expect(normalizeCode('ABC_00123')).toBe('ABC-123')
    expect(normalizeCode('ssis-001')).toBe('SSIS-001')
    expect(normalizeCode('fc2 ppv 1234567')).toBe('FC2-PPV-1234567')
    expect(normalizeCode('今晚看什么')).toBeNull()
    expect(
      exactCodeMatch(
        [{ title: 'ABC-123 片名' }, { title: 'ABC-124' }],
        'ABC-123'
      )
    ).toEqual({ title: 'ABC-123 片名' })
  })

  it('按番号：库里唯一命中时打开详情，否则带着番号去搜', async () => {
    fakes.find.mockResolvedValue({
      items: [{ id: 9, title: 'ABC-123' }],
      total: 1,
    })
    expect(
      (await run({ action: 'private.code', target: 'abc123' })).close
    ).toBe(true)
    expect(fakes.find).toHaveBeenCalledWith('jav', 'ABC-123')
    expect(router.push).toHaveBeenLastCalledWith({
      path: '/jav',
      query: { item: '9' },
    })
    fakes.find.mockResolvedValue({ items: [], total: 0 })
    await run({ action: 'private.code', target: 'XYZ-078' })
    expect(router.push).toHaveBeenLastCalledWith({
      path: '/jav',
      query: { q: 'XYZ-078' },
    })
    expect(
      parseIntent(raw({ action: 'private.code', target: '随便' }), skills)
        .intent.kind
    ).toBe('answer')
  })

  it('自然语言搜索：跳到番号库，强制交给自然语言解析并要求只用本地模型', async () => {
    await run({ action: 'private.search', text: '2024 年的无码' })
    expect(router.push).toHaveBeenLastCalledWith({
      path: '/jav',
      query: { q: '?2024 年的无码', localOnly: '1' },
    })
  })

  it('继续播放：只列私密板块的记录（板块来自合并 meta 后的路由表）', async () => {
    const rec = (id: string, section: string): Record<string, unknown> => ({
      id,
      section,
      key: id,
      title: id,
      replay: {},
      progress: 60,
      duration: 240,
      updatedAt: 0,
    })
    fakes.records = [rec('a', 'movie'), rec('b', 'jav'), rec('c', 'av')]
    const outcome = await run({ action: 'private.continue' })
    expect(outcome.result).toMatchObject({
      kind: 'cards',
      cards: [{ id: 'b' }, { id: 'c' }],
    })
  })

  it('去码模式：留空时处理当前详情，找到视频后开始边跑边看', async () => {
    fakes.video.mockResolvedValue('/media/a.mp4')
    expect((await run({ action: 'private.restore' })).close).toBe(true)
    expect(fakes.video).toHaveBeenCalledWith(42)
    expect(fakes.startLive).toHaveBeenCalledWith('/media/a.mp4')
    fakes.find.mockResolvedValue({ items: [], total: 0 })
    const miss = await run({ action: 'private.restore', target: 'ABC-123' })
    expect(miss.message).toContain('没找到')
  })

  it('随机一部：给一张卡片，点击播放', async () => {
    fakes.random.mockResolvedValue({
      id: 5,
      title: 'DEF-210',
      poster: 'p.jpg',
      year: 2026,
      rating: null,
    })
    const outcome = await run({ action: 'private.random' })
    if (outcome.result?.kind !== 'cards') throw new Error('kind')
    expect(outcome.result.cards[0]).toMatchObject({
      title: 'DEF-210',
      meta: '2026',
    })
    await outcome.result.cards[0].play()
    expect(fakes.playItem).toHaveBeenCalledWith(5)
  })
})
