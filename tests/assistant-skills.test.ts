/**
 * AI 助手技能包：注册表按模式取技能、提示词与 JSON Schema 由已登记技能动态拼出、
 * 模型输出严格校验（未知动作 / 越界参数 / 私密页面一律只回答文字）、按状态路由、
 * 上下文（页面、在播片名与时间点）、普通模式无敏感词。媒体库与播放器换成替身。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/library', () => ({}))

vi.mock('@/features/player', async () => {
  const { shallowRef } = await import('vue')
  return {
    askPlotQuestion: vi.fn(),
    continueRecords: () => shallowRef([]),
    metaOf: vi.fn(),
    openMediaPlayer: vi.fn(),
    progressRatio: () => 0,
    replayOptions: vi.fn(),
    runPlayerCommand: vi.fn(),
  }
})

import {
  SENSITIVE,
  idle,
  playing,
  privateIdle,
  raw,
} from './assistant-fixtures'
import { routes } from '../src/renderer/src/router/routers'
import {
  ensureCoreSkills,
  privateRouteSections,
  privateSections,
  registerCoreSkills,
} from '../src/renderer/src/features/assistant/skills/core-skills'
import {
  assistantPages,
  isPrivateRoute,
  resolvedRoutes,
} from '../src/renderer/src/features/assistant/skills/navigation-skill'
import { parsePlayerCommand } from '../src/renderer/src/features/assistant/skills/player-skill'
import {
  ASK_CHARS,
  type AssistantIntent,
  buildIntentMessages,
  intentSchema,
  parseIntent,
  routeIntent,
  skillPlaceholder,
  skillSuggestions,
} from '../src/renderer/src/features/assistant/skills/skill-prompt'
import { createSkillRegistry } from '../src/renderer/src/features/assistant/skills/skill-registry'
import {
  type AssistantSkill,
  defineAction,
} from '../src/renderer/src/features/assistant/skills/skill-types'

/** 一个只在私密模式生效的替身技能 */
const secret: AssistantSkill = {
  id: 'secret',
  scope: 'private',
  actions: [
    defineAction<string>({
      name: 'find',
      describe: '按番号找片',
      parse: raw => raw.target || null,
      run: async () => ({ message: '', result: null }),
    }),
  ],
  placeholder: '问私密库…',
  prompt: () => ['私密说明：番号'],
  suggestions: () => ['按番号搜'],
}

function coreRegistry(): ReturnType<typeof createSkillRegistry> {
  const registry = createSkillRegistry()
  registerCoreSkills(registry, routes)
  return registry
}

describe('注册表', () => {
  it('登记、同 id 替换、卸载；按模式取生效技能', () => {
    const registry = coreRegistry()
    expect(registry.list().map(s => s.id)).toEqual([
      'library',
      'discover',
      'player',
      'navigation',
    ])
    registry.register(secret)
    expect(registry.active(idle).map(s => s.id)).toEqual([
      'library',
      'discover',
      'player',
      'navigation',
    ])
    expect(registry.active(privateIdle).map(s => s.id)).toEqual([
      'player',
      'navigation',
      'secret',
    ])
    registry.register({ ...secret, actions: [] })
    expect(registry.list().filter(s => s.id === 'secret')).toHaveLength(1)
    registry.unregister('secret')
    expect(registry.has('secret')).toBe(false)
  })

  it('可跳转页面来自路由表，私密路由不在其中；私密板块据此排除', () => {
    const ids = assistantPages(routes).map(page => page.id)
    expect(ids).toEqual([
      'search',
      'online',
      'movie',
      'tv',
      'calendar',
      'live',
      'netdisk',
    ])
    expect([...privateSections(routes)].sort()).toEqual(['av', 'jav'])
  })
})

describe('提示词与 Schema 动态拼出', () => {
  it('动作名来自已登记技能；私密技能只在私密模式进提示词', () => {
    const registry = coreRegistry()
    registry.register(secret)
    const normal = registry.active(idle)
    const schema = intentSchema(normal) as {
      properties: { action: { enum: string[] } }
    }
    expect(schema.properties.action.enum).toEqual([
      'library.continue',
      'library.search',
      'discover.discover',
      'player.control',
      'player.plot',
      'navigation.navigate',
      'navigation.settings',
      'answer',
    ])
    const prompt = buildIntentMessages('你好', idle, normal)[0].content
    expect(prompt).toContain('- library.search：')
    expect(prompt).not.toContain('secret.find')

    const hidden = registry.active(privateIdle)
    const privatePrompt = buildIntentMessages('你好', privateIdle, hidden)
    expect(privatePrompt[0].content).toContain('- secret.find：按番号找片')
    expect(privatePrompt[0].content).toContain('私密说明')
    expect(privatePrompt[0].content).not.toContain('library.search')
  })

  it('普通模式：提示词、Schema、建议、占位文字都没有敏感词（私密技能已登记也一样）', () => {
    const registry = coreRegistry()
    registry.register(secret)
    for (const context of [idle, playing]) {
      const skills = registry.active(context)
      const text = [
        buildIntentMessages('找一部科幻电影', context, skills)[0].content,
        JSON.stringify(intentSchema(skills)),
        skillSuggestions(skills, context).join(' '),
        skillPlaceholder(skills, '问影盒…'),
      ].join('\n')
      expect(text).not.toMatch(SENSITIVE)
    }
  })

  it('上下文：页面、在播片名与时间点；带上前几轮对话；输入截到上限', () => {
    const skills = coreRegistry().active(playing)
    const history = [
      { role: 'user' as const, content: '放沙丘' },
      { role: 'assistant' as const, content: '好的' },
    ]
    const messages = buildIntentMessages(
      '啊'.repeat(500),
      playing,
      skills,
      history
    )
    expect(messages[0].content).toContain('「电影」页面')
    expect(messages[0].content).toContain('《沙丘：第二部》，播到 1:32:10')
    expect(messages.slice(1, 3)).toEqual(history)
    expect([...messages[3].content]).toHaveLength(ASK_CHARS)
    expect(buildIntentMessages('你好', idle, skills)[0].content).toContain(
      '没有在播放'
    )
  })

  it('建议：播放中给播放器相关的，私密模式私密技能在前；占位文字取私密技能的', () => {
    const registry = coreRegistry()
    registry.register(secret)
    expect(skillSuggestions(registry.active(playing), playing)).toContain(
      '关掉弹幕'
    )
    expect(skillSuggestions(registry.active(idle), idle)[0]).toBe(
      '继续上次看的'
    )
    const hidden = registry.active(privateIdle)
    expect(skillSuggestions(hidden, privateIdle)[0]).toBe('按番号搜')
    expect(skillPlaceholder(hidden, '问影盒…')).toBe('问私密库…')
  })
})

describe('parseIntent：严格校验', () => {
  const skills = coreRegistry().active(idle)
  const parse = (
    fields: Record<string, unknown>
  ): ReturnType<typeof parseIntent> => parseIntent(raw(fields), skills)
  const kind = (fields: Record<string, unknown>): string => {
    const { intent } = parse(fields)
    return intent.kind === 'action' ? intent.id : 'answer'
  }

  it('合法动作与参数', () => {
    const search = parse({
      action: 'library.search',
      target: 'tv',
      text: '韩剧',
      reply: '好的',
    })
    expect(search.reply).toBe('好的')
    expect(search.intent).toMatchObject({
      kind: 'action',
      id: 'library.search',
      params: { section: 'tv', query: '韩剧' },
    })
    expect(
      parse({ action: 'player.control', command: 'danmakuOpacity', value: 50 })
        .intent
    ).toMatchObject({ params: { kind: 'danmakuOpacity', value: 0.5 } })
    expect(
      parse({ action: 'player.control', command: 'sleep', target: 'episode' })
        .intent
    ).toMatchObject({ params: { kind: 'sleep', choice: 'episode' } })
    expect(
      parse({ action: 'navigation.navigate', target: 'calendar' }).intent
    ).toMatchObject({ params: { path: '/calendar' } })
    expect(
      parse({ action: 'navigation.navigate', target: 'netdisk' }).intent
    ).toMatchObject({ params: { path: '/netdisk' } })
    expect(
      parse({ action: 'navigation.settings', target: 'netdisk' }).intent
    ).toMatchObject({ params: 'netdisk' })
  })

  it('不是对象、未知动作、私密技能的动作（普通模式）一律只回答文字', () => {
    expect(parseIntent(null, skills).intent.kind).toBe('answer')
    expect(parseIntent([raw({})], skills).intent.kind).toBe('answer')
    expect(kind({ action: 'deleteLibrary', reply: '已删除' })).toBe('answer')
    expect(kind({ action: 'search', target: 'movie', text: 'x' })).toBe(
      'answer'
    )
    expect(kind({ action: 'secret.find', target: 'ABC-123' })).toBe('answer')
    expect(parse({ action: 'answer', reply: '你好' }).reply).toBe('')
  })

  it('私密 / 不存在的页面、清单外的设置分区、越界参数', () => {
    for (const target of ['jav', 'av', '/jav', 'http://evil', '../'])
      expect(kind({ action: 'navigation.navigate', target })).toBe('answer')
    for (const target of ['lada', 'section-lock', 'constructor'])
      expect(kind({ action: 'navigation.settings', target })).toBe('answer')
    expect(
      kind({ action: 'library.search', target: 'jav', text: '新片' })
    ).toBe('answer')
    expect(kind({ action: 'player.control', command: 'rate', value: 10 })).toBe(
      'answer'
    )
    // 数字写成字符串按数字读（模型常这样输出），仍要过范围校验
    expect(
      kind({ action: 'player.control', command: 'rate', value: '2' })
    ).toBe('player.control')
    expect(
      kind({ action: 'player.control', command: 'rate', value: '10' })
    ).toBe('answer')
    expect(
      kind({ action: 'player.control', command: 'rate', value: '快' })
    ).toBe('answer')
    expect(kind({ action: 'player.control', command: 'shutdown' })).toBe(
      'answer'
    )
    expect(kind({ action: 'player.plot', text: '   ' })).toBe('answer')
  })
})

describe('routeIntent：动作自己的门槛', () => {
  const skills = coreRegistry().active(idle)
  const intent = (fields: Record<string, unknown>): AssistantIntent =>
    parseIntent(raw(fields), skills).intent

  it('播放器命令：不在播放 / 外置播放器给说明，播放中执行', () => {
    const rate = intent({ action: 'player.control', command: 'rate', value: 2 })
    expect(routeIntent(rate, idle).kind).toBe('explain')
    expect(
      routeIntent(rate, { ...playing, controllable: false })
    ).toMatchObject({ kind: 'explain', text: expect.stringContaining('外置') })
    expect(routeIntent(rate, playing)).toEqual({ kind: 'run', intent: rate })
  })

  it('剧情问题：不在播放时当普通问题回答，不支持时说明', () => {
    const plot = intent({ action: 'player.plot', text: '前面讲了什么' })
    expect(routeIntent(plot, playing).kind).toBe('run')
    expect(routeIntent(plot, { ...playing, plotQa: false }).kind).toBe(
      'explain'
    )
    expect(routeIntent(plot, idle)).toEqual({
      kind: 'run',
      intent: { kind: 'answer' },
    })
  })
})

describe('路由 meta 合并与内置技能只登记一次', () => {
  /** 父路由带 adultOnly、子路由自身没有：getRoutes() 看不到，resolve 合并后才有 */
  const table = {
    getRoutes: () => [
      { path: '/movie', meta: { title: '电影' } },
      { path: '/hidden', meta: { title: 'x' } },
      { path: '/item/:id', meta: {} },
    ],
    resolve: (path: string) => ({
      path,
      meta: path === '/hidden' ? { title: 'x', adultOnly: true } : {},
      matched: [],
    }),
  }

  it('resolvedRoutes 带上父路由的 adultOnly，私密页面不进跳转清单', () => {
    expect([...privateRouteSections(table)]).toEqual(['hidden'])
    expect(assistantPages(resolvedRoutes(table)).map(p => p.id)).toEqual([
      'movie',
    ])
    expect(
      isPrivateRoute({ path: '/a', matched: [{ meta: { adultOnly: true } }] })
    ).toBe(true)
  })

  it('ensureCoreSkills 已登记过就不再重复登记', () => {
    const registry = createSkillRegistry()
    ensureCoreSkills(registry, table)
    const first = registry.list()
    ensureCoreSkills(registry, table)
    expect(registry.list()).toBe(first)
  })
})

describe('卡片角标与播放器参数', () => {
  it('弹幕 / 字幕开关只认布尔 on', () => {
    const base = { text: '', target: '', value: null, command: 'danmaku' }
    expect(parsePlayerCommand({ ...base, on: false })).toEqual({
      kind: 'danmaku',
      on: false,
    })
    for (const on of [null, undefined, 'true', 1])
      expect(
        parsePlayerCommand({ ...base, on } as unknown as Parameters<
          typeof parsePlayerCommand
        >[0])
      ).toBeNull()
  })
})
