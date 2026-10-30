// @vitest-environment jsdom
/**
 * 统一入口（搜索 + AI 助手）居中浮层的挂载：openAssistant（侧栏搜索框入口）打开、Cmd/Ctrl+K / Shift+K / F 与全局快捷键事件唤起、
 * 输入即出片库结果、「问 AI」行、回车 / Cmd+回车 / ↑↓ 的规则、界面口令、
 * Esc / Esc 键帽 / 点遮罩收起、未配置 AI 时显示「去设置 AI」；空闲时大标题 + 上下文胶囊 + 玻璃输入胶囊 +
 * 建议 + 快捷键提示，有对话后同一列展开成玻璃面板（普通页面模态 + 遮罩；播放器前台时一律面板、没有遮罩、
 * 整层不拦点击、不做模态）；对话流（你说的话、上一轮回答归档）；没有光球与边缘光圈；
 * 普通模式 DOM 无敏感词（私密技能已登记也一样）；私密模式的上下文胶囊与占位文字（不换色调）；
 * 私密模式切换或收起时清空对话上下文；窗口新建时取走待处理的唤起、收起后焦点回到打开前的元素、
 * 模态浮层的焦点陷阱、按住 Cmd/Ctrl+Shift+K 的自动重复不算。AI、播放器、媒体库换成替身。
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  type App,
  type VNode,
  createApp,
  defineComponent,
  h,
  nextTick,
} from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const fakes = vi.hoisted(() => ({
  chatJson: vi.fn(),
  chatStream: vi.fn(),
  configured: true,
  player: null as unknown,
  summon: null as null | (() => void),
  pendingSummon: false,
  modal: null as null | { value: unknown },
  /** 片库搜索替身返回的结果 */
  results: [] as { key: string; title: string; exact: boolean }[],
  /** 打开过的结果 */
  opened: [] as string[],
  adult: { value: false },
  /** 在线搜索替身：search(q) 后同步给出这些条目 */
  onlineItems: [] as {
    vod_name: string
    vod_year: string
    source_name: string
  }[],
  onlineSearches: [] as string[],
  onlineOpened: [] as unknown[],
}))

vi.mock('@/features/online', async () => {
  const { ref } = await import('vue')
  return {
    onlineAvailable: () => true,
    requestOnlineDetail: (item: unknown) => fakes.onlineOpened.push(item),
    useOnlineSearch: () => {
      const results = ref<unknown[]>([])
      const keyword = ref('')
      return {
        results,
        keyword,
        loading: ref(false),
        error: ref(''),
        failedSources: ref<string[]>([]),
        skippedPlugins: ref<string[]>([]),
        skippedCms: ref<string[]>([]),
        search: async (q: string) => {
          fakes.onlineSearches.push(q)
          keyword.value = q
          results.value = fakes.onlineItems.map(item => ({
            ...item,
            vod_pic: '',
          }))
        },
      }
    },
  }
})

vi.mock('@/features/ai', () => ({
  AiCallError: class extends Error {},
  aiAvailable: () => true,
  aiConfigured: () => fakes.configured,
  aiKeyConfigured: () => true,
  chatJson: fakes.chatJson,
  chatStream: fakes.chatStream,
}))

vi.mock('@/features/player', async () => {
  const { shallowRef: sref } = await import('vue')
  const modal = sref<unknown>(null)
  return {
    playerSession: () => {
      if (fakes.modal !== modal) modal.value = fakes.player
      fakes.modal = modal
      return modal
    },
    playerNowPlaying: () => null,
    playerRemoteState: () => ({
      playing: false,
      controllable: false,
      plotQa: false,
      private: false,
    }),
    askPlotQuestion: vi.fn(),
    continueRecords: () => sref([]),
    metaOf: vi.fn(),
    openMediaPlayer: vi.fn(),
    progressRatio: () => 0,
    replayOptions: vi.fn(),
    runPlayerCommand: vi.fn(),
  }
})

vi.mock('@/features/library', async () => {
  const { computed, h, ref } = await import('vue')
  const lib = {
    librarySearchScope: (_route: unknown, isPrivate: boolean) =>
      isPrivate ? 'jav' : 'all',
    librarySectionLabel: () => null,
    useLibrarySearch: (options: {
      text: () => string
      open: () => boolean
      leave: () => void
    }) => {
      const rows = computed(() =>
        options.open() && options.text() ? fakes.results : []
      )
      const open = (key: string): void => {
        fakes.opened.push(key)
        options.leave()
      }
      return {
        best: computed(() =>
          rows.value.map(row => ({ key: row.key, item: { title: row.title } }))
        ),
        moments: computed(() => []),
        actors: computed(() => []),
        entries: computed(() =>
          rows.value.map(row => ({
            key: row.key,
            exact: row.exact,
            open: () => open(row.key),
          }))
        ),
        busy: ref(false),
        thinking: ref(false),
        message: ref(''),
        visualNotice: ref(''),
        openHit: (hit: { key: string }) => open(hit.key),
        openMoment: vi.fn(),
        openActor: vi.fn(),
        canWall: computed(() => false),
        wall: vi.fn(),
        canOnline: computed(() => true),
        online: vi.fn(),
        canPickVisual: computed(() => false),
      }
    },
    /** 结果列表替身（函数组件）：before 插槽 + 每条结果一个可点的 option */
    SearchMatches: (
      props: {
        best: { key: string; item: { title: string } }[]
        selected: number
        listId: string
        onOpen: (hit: unknown) => void
      },
      { slots }: { slots: { before?: () => VNode[]; after?: () => VNode[] } }
    ) =>
      h('div', { id: props.listId, role: 'listbox' }, [
        slots.before?.(),
        ...props.best.map((hit, index) =>
          h(
            'button',
            {
              id: `search-hit-${index}`,
              role: 'option',
              'data-search-result': '',
              'aria-selected': props.selected === index,
              onClick: () => props.onOpen(hit),
            },
            hit.item.title
          )
        ),
        slots.after?.(),
      ]),
    VisualSourceSelect: { render: () => null },
  }
  return {
    loadLibrarySearch: async () => lib,
    libraryCardInfo: async () => null,
  }
})

vi.mock('@/features/settings', () => ({
  useSetting: () => fakes.adult,
  getSetting: (key: string) =>
    key === 'ai.provider'
      ? 'deepseek'
      : key === 'ai.model'
        ? 'deepseek-chat'
        : key === 'ai.speech.engine'
          ? 'off'
          : '',
}))

import { SENSITIVE } from './assistant-fixtures'
import AssistantLauncher from '../src/renderer/src/features/assistant/AssistantLauncher.vue'
import { openAssistant } from '../src/renderer/src/features/assistant/assistant-open'
import {
  assistantSessionSize,
  clearAssistantSession,
  recordAssistantTurn,
} from '../src/renderer/src/features/assistant/assistant-session'
import { assistantSkills } from '../src/renderer/src/features/assistant/skills/skill-registry'
import type { AssistantSkill } from '../src/renderer/src/features/assistant/skills/skill-types'

/** 私密技能替身：只在私密模式生效 */
const secretSkill: AssistantSkill = {
  id: 'secret',
  scope: 'private',
  actions: [],
  placeholder: '问私密库…',
  prompt: () => ['番号'],
  suggestions: () => ['按番号搜', '用去码模式播放'],
}

let app: App | null = null
let host: HTMLElement
let router: ReturnType<typeof createRouter>

/** 等异步组件加载与过渡 */
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, ms))
    await nextTick()
  }
}

/** 轮询直到条件成立（异步组件第一次加载较慢） */
async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('等待超时')
    await settle(20)
  }
}

async function mount(path = '/'): Promise<void> {
  const page = { render: () => h('div') }
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: page, meta: { title: '在线' } },
      {
        path: '/secret',
        component: page,
        meta: { title: 'x', adultOnly: true },
      },
    ],
  })
  await router.push(path)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(defineComponent({ render: () => h(AssistantLauncher) }))
  app.use(router)
  app.mount(host)
  await nextTick()
}

const overlay = (): Element | null => document.querySelector('.assistant')
const panel = (): HTMLElement =>
  document.querySelector<HTMLElement>('.assistant-panel')!

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

// 浮层是异步组件：先把它的模块加载好，免得第一条用例在高负载下等第一次下载超时
beforeAll(async () => {
  await import('../src/renderer/src/features/assistant/AssistantOverlay.vue')
}, 30_000)

beforeEach(() => {
  fakes.results = []
  fakes.opened = []
  fakes.onlineItems = []
  fakes.onlineSearches = []
  fakes.onlineOpened = []
  fakes.adult.value = false
  fakes.chatJson.mockReset()
  fakes.chatStream.mockReset()
  clearAssistantSession()
  fakes.configured = true
  fakes.player = null
  fakes.modal = null
  assistantSkills.register(secretSkill)
  fakes.summon = null
  fakes.pendingSummon = false
  ;(window as unknown as { api: unknown }).api = {
    assistant: {
      onSummon: (cb: () => void) => {
        fakes.summon = cb
      },
      offSummon: vi.fn(),
      takeSummon: vi.fn(async () => {
        const pending = fakes.pendingSummon
        fakes.pendingSummon = false
        return pending
      }),
    },
  }
})

afterEach(() => {
  assistantSkills.unregister('secret')
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('AssistantLauncher', () => {
  it('openAssistant 打开居中浮层：大标题、上下文胶囊、玻璃输入胶囊「搜索片库，或问影盒…」+ 示例、建议胶囊、快捷键提示', async () => {
    await mount()
    expect(overlay()).toBeNull()
    openAssistant()
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-layout')).toBe('page')
    expect(overlay()!.getAttribute('data-mode')).toBe('hero')
    // 空闲时一列没有底，输入胶囊本身是玻璃；没有光球与整圈边缘光，只有输入胶囊上沿的渐变
    expect(panel().classList.contains('yb-glass')).toBe(false)
    expect(
      document.querySelector('.assistant-field')!.classList.contains('yb-glass')
    ).toBe(true)
    expect(document.querySelector('.assistant-orb')).toBeNull()
    expect(document.querySelector('.edge-glow')).toBeNull()
    expect(document.querySelector('.assistant-streak')).not.toBeNull()
    expect(overlay()!.getAttribute('data-private')).toBe('false')
    expect(document.querySelector('.assistant-hello')?.textContent).toBe(
      '有什么可以帮你？'
    )
    const chips = [...document.querySelectorAll('.assistant-chip')].map(el =>
      el.textContent?.trim()
    )
    expect(chips).toEqual(['在线 · 当前页面', 'deepseek-chat'])
    // 空闲时 Esc 在快捷键提示里（可点），顶上没有键帽
    expect(
      document.querySelector('.assistant-head .assistant-close')
    ).toBeNull()
    const keys = document.querySelector('.assistant-keys')!.textContent!
    expect(keys).toContain('打开 / 发送')
    expect(keys).toContain('问 AI')
    expect(keys).toContain('Ctrl K')
    expect(keys).toContain('唤起 / 收起')
    expect(
      document.querySelector('.assistant-keys .assistant-close')?.textContent
    ).toContain('Esc')
    // 状态行只给读屏：待命未提问时为空，不与大标题重复
    expect(document.querySelector('.assistant-status')?.textContent).toBe('')
    expect(document.querySelector('.assistant-thread')).toBeNull()
    expect(document.querySelector('.assistant-question')).toBeNull()
    expect(
      document
        .querySelector('.assistant-input input')
        ?.getAttribute('placeholder')
    ).toBe('搜索片库，或问影盒…')
    expect(document.querySelector('.assistant-example')?.textContent).toMatch(
      /^例如「.+」$/
    )
    expect(
      document.querySelectorAll('.assistant-suggestions .ui-chip').length
    ).toBe(4)
  })

  it('Esc 收起浮层', async () => {
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
  })

  it('Esc 键帽与点变暗区收起', async () => {
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    ;(document.querySelector('.assistant-close') as HTMLElement).click()
    await settle(100)
    expect(overlay()).toBeNull()
    openAssistant()
    await settle()
    ;(document.querySelector('.assistant-scrim') as HTMLElement).click()
    await settle(100)
    expect(overlay()).toBeNull()
  })

  it('Ctrl+Shift+K 切换；全局快捷键事件（summon）打开', async () => {
    await mount()
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await settle()
    expect(overlay()).not.toBeNull()
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await settle(100)
    expect(overlay()).toBeNull()
    fakes.summon!()
    await settle()
    expect(overlay()).not.toBeNull()
  })

  it('未配置 AI：你说的话进对话流，并显示「去设置 AI」', async () => {
    fakes.configured = false
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    const input = document.querySelector(
      '.assistant-input input'
    ) as HTMLInputElement
    input.value = '找一部科幻电影'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await settle(50)
    expect(
      document.querySelector('.assistant-question')?.textContent
    ).toContain('找一部科幻电影')
    // 有对话：同一列展开成玻璃面板，输入胶囊变成面板里的内凹胶囊，顶上出现 Esc 键帽，大标题与建议收起
    expect(overlay()!.getAttribute('data-mode')).toBe('panel')
    expect(panel().classList.contains('yb-glass')).toBe(true)
    expect(
      document.querySelector('.assistant-field')!.classList.contains('yb-glass')
    ).toBe(false)
    expect(document.querySelector('.assistant-hello')).toBeNull()
    expect(document.querySelector('.assistant-keys')).toBeNull()
    expect(document.querySelector('.assistant-suggestions')).toBeNull()
    expect(
      document.querySelector('.assistant-head .assistant-close')?.textContent
    ).toContain('Esc')
    expect(
      document
        .querySelector('.assistant-input input')
        ?.getAttribute('placeholder')
    ).toBe('继续问，或搜索片库…')
    expect(document.querySelector('.assistant-setup')?.textContent).toContain(
      '去设置 AI'
    )
  })

  it('再问一句：上一轮的问话与模型回答都归档在对话流里，新的一句接在后面', async () => {
    // 配置好 AI：归意图返回「直接回答」，每次回答写明是第几次
    fakes.chatJson.mockResolvedValue({ data: {} })
    let calls = 0
    fakes.chatStream.mockImplementation(
      async (_request: unknown, options: { onDelta: (d: string) => void }) => {
        calls += 1
        options.onDelta(`回答 ${calls}`)
      }
    )
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    const input = document.querySelector(
      '.assistant-input input'
    ) as HTMLInputElement
    for (const text of ['第一句', '第二句']) {
      input.value = text
      input.dispatchEvent(new Event('input'))
      await nextTick()
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
      await settle(50)
    }
    const questions = [...document.querySelectorAll('.assistant-question')].map(
      el => el.textContent
    )
    expect(questions).toEqual(['第一句', '第二句'])
    const answers = [...document.querySelectorAll('.assistant-answer')].map(
      el => el.textContent?.trim()
    )
    expect(answers).toEqual(['回答 1', '回答 2'])
    // 第一轮已归档：它在第二轮的问话前面，且不是「去设置 AI」那条说明
    expect(document.querySelectorAll('.assistant-turn').length).toBe(2)
    expect(document.querySelector('.assistant-setup')).toBeNull()
  })

  it('普通模式：DOM 里没有敏感词（私密技能已登记也不出现）', async () => {
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    expect(document.body.textContent).not.toMatch(SENSITIVE)
    expect(document.body.innerHTML).not.toMatch(SENSITIVE)
  })

  it('私密模式：上下文胶囊「私密 · 仅本地模型 · 无痕」、不举例、私密技能的建议与占位文字', async () => {
    await mount('/secret')
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-private')).toBe('true')
    expect(
      document.querySelector('.assistant-chip.is-private')?.textContent
    ).toContain('私密 · 仅本地模型 · 无痕')
    expect(document.querySelector('.assistant-example')).toBeNull()
    expect(
      document
        .querySelector('.assistant-input input')
        ?.getAttribute('placeholder')
    ).toBe('问私密库…')
    expect(
      document.querySelector('.assistant-suggestions')?.textContent
    ).toContain('按番号搜')
  })

  it('离开私密分区：收起浮层并清空对话上下文', async () => {
    await mount('/secret')
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await waitFor(() => overlay() !== null)
    recordAssistantTurn('问', '答', true)
    await router.push('/')
    await settle(100)
    expect(overlay()).toBeNull()
    expect(assistantSessionSize()).toBe(0)
  })

  it('网页端播放层在前台：一律玻璃面板，没有遮罩、整层不拦点击、不做模态', async () => {
    fakes.player = { private: false, inPage: true }
    await mount()
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-layout')).toBe('player')
    // 画面上没有遮罩托底：还没提问也是面板形态，没有大标题
    expect(overlay()!.getAttribute('data-mode')).toBe('panel')
    expect(panel().classList.contains('yb-glass')).toBe(true)
    expect(document.querySelector('.assistant-hello')).toBeNull()
    expect(panel().getAttribute('aria-modal')).toBe('false')
    // 不拦点击：没有遮罩元素；整层 pointer-events: none 的样式约束见 assistant-layout.test.ts
    expect(document.querySelector('.assistant-scrim')).toBeNull()
    // 不拦焦点：焦点移到浮层外（播放器控件）后不会被拉回
    const control = document.createElement('button')
    document.body.appendChild(control)
    await settle(50)
    control.focus()
    await settle()
    expect(document.activeElement).toBe(control)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
  })

  it('私密模式下收起浮层：清空对话上下文（关掉就不留记录）', async () => {
    await mount('/secret')
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await waitFor(() => overlay() !== null)
    recordAssistantTurn('问', '答', true)
    expect(assistantSessionSize()).toBe(1)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
    expect(assistantSessionSize()).toBe(0)
  })

  it('普通模式下收起浮层：对话上下文保留', async () => {
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    recordAssistantTurn('问', '答', false)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
    expect(assistantSessionSize()).toBe(1)
  })

  it('全局快捷键新建了窗口：挂载后取走待处理的唤起并打开', async () => {
    fakes.pendingSummon = true
    await mount()
    await waitFor(() => overlay() !== null)
    expect(fakes.pendingSummon).toBe(false)
  })

  it('收起后焦点回到打开前的元素（侧栏入口）', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    await mount()
    trigger.focus()
    openAssistant()
    await waitFor(() => overlay() !== null)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('按住 Cmd/Ctrl+Shift+K 的自动重复不反复开合', async () => {
    await mount()
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await settle()
    key({ key: 'K', ctrlKey: true, shiftKey: true, repeat: true })
    await settle(100)
    expect(overlay()).not.toBeNull()
  })

  it('普通页面的浮层是模态：焦点被移到浮层外时拉回浮层', async () => {
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    await mount()
    key({ key: 'K', ctrlKey: true, shiftKey: true })
    await waitFor(() => overlay() !== null)
    await settle(50)
    outside.focus()
    await settle()
    expect(panel().contains(document.activeElement)).toBe(true)
  })
})

describe('统一入口：搜索与问 AI', () => {
  const input = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>('.assistant-input input')!

  async function type(text: string): Promise<void> {
    input().value = text
    input().dispatchEvent(new Event('input'))
    await settle()
  }

  function press(init: KeyboardEventInit): void {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, ...init })
    )
  }

  async function openEntry(): Promise<void> {
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
  }

  it('输入即出结果：「问 AI」行在最上并默认选中，回车交给 AI；结果块替换建议、快捷键提示仍在', async () => {
    fakes.results = [
      { key: 'a', title: '星际穿越', exact: false },
      { key: 'b', title: '星球大战', exact: false },
    ]
    await openEntry()
    await type('星际')
    expect(overlay()!.getAttribute('data-searching')).toBe('true')
    const rows = [...document.querySelectorAll('[role="option"]')]
    expect(rows[0].id).toBe('entry-ask')
    expect(rows[0].textContent).toContain('问 AI：星际')
    expect(rows.slice(1).map(row => row.textContent)).toEqual([
      '星际穿越',
      '星球大战',
    ])
    expect(document.querySelector('.assistant-search.yb-glass')).not.toBeNull()
    expect(document.querySelector('.assistant-suggestions')).toBeNull()
    expect(document.querySelector('.assistant-keys')).not.toBeNull()
    expect(input().getAttribute('role')).toBe('combobox')
    expect(input().getAttribute('aria-controls')).toBe('entry-results')
    expect(input().getAttribute('aria-activedescendant')).toBe('entry-ask')
    expect(
      document.querySelector('.assistant-search-note')?.textContent
    ).toMatch(/^2 个结果/)
    press({ key: 'Enter' })
    await settle(50)
    expect(fakes.opened).toEqual([])
    expect(
      document.querySelector('.assistant-question')?.textContent
    ).toContain('星际')
    expect(input().value).toBe('')
    expect(overlay()!.getAttribute('data-mode')).toBe('panel')
  })

  it('片名精确命中默认选中，回车直接打开并收起浮层', async () => {
    fakes.results = [{ key: 'x', title: '流浪地球', exact: true }]
    await openEntry()
    await type('流浪地球')
    expect(input().getAttribute('aria-activedescendant')).toBe('search-hit-0')
    press({ key: 'Enter' })
    await settle(50)
    expect(fakes.opened).toEqual(['x'])
    await waitFor(() => overlay() === null)
    expect(fakes.chatJson).not.toHaveBeenCalled()
  })

  it('↑ ↓ 在「问 AI」与结果间循环；Cmd/Ctrl+回车不管选中哪行都问 AI', async () => {
    fakes.results = [
      { key: 'a', title: '甲', exact: false },
      { key: 'b', title: '乙', exact: false },
    ]
    await openEntry()
    await type('片')
    press({ key: 'ArrowDown' })
    await nextTick()
    expect(input().getAttribute('aria-activedescendant')).toBe('search-hit-0')
    press({ key: 'ArrowUp' })
    press({ key: 'ArrowUp' })
    await nextTick()
    expect(input().getAttribute('aria-activedescendant')).toBe('search-hit-1')
    // 组字中的方向键不算
    press({ key: 'ArrowDown', isComposing: true })
    await nextTick()
    expect(input().getAttribute('aria-activedescendant')).toBe('search-hit-1')
    press({ key: 'Enter', ctrlKey: true })
    await settle(50)
    expect(fakes.opened).toEqual([])
    expect(
      document.querySelector('.assistant-question')?.textContent
    ).toContain('片')
  })

  it('选中结果后回车打开它；点结果行也能打开', async () => {
    fakes.results = [{ key: 'a', title: '甲', exact: false }]
    await openEntry()
    await type('甲')
    press({ key: 'ArrowDown' })
    press({ key: 'Enter' })
    await settle(50)
    expect(fakes.opened).toEqual(['a'])
    await waitFor(() => overlay() === null)
    openAssistant()
    await waitFor(() => overlay() !== null)
    await type('甲')
    document.querySelector<HTMLButtonElement>('#search-hit-0')!.click()
    await settle(50)
    expect(fakes.opened).toEqual(['a', 'a'])
  })

  it('AI 未配置：片库结果照常出现，「问 AI」行说明需要先配置', async () => {
    fakes.configured = false
    fakes.results = [{ key: 'a', title: '甲', exact: false }]
    await openEntry()
    await type('甲')
    expect(document.querySelector('[data-search-result]')?.textContent).toBe(
      '甲'
    )
    expect(document.querySelector('#entry-ask')?.textContent).toContain(
      '还没有配置 AI'
    )
  })

  it('Ctrl+K 开合、Ctrl+F 只打开', async () => {
    await mount()
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    key({ key: 'f', ctrlKey: true })
    await settle(30)
    expect(overlay()).not.toBeNull()
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() === null)
    key({ key: 'f', ctrlKey: true })
    await waitFor(() => overlay() !== null)
  })

  it('界面口令：回车切换成人模式并收起，不搜索也不问 AI', async () => {
    fakes.results = [{ key: 'a', title: '甲', exact: true }]
    await openEntry()
    await type('getav')
    expect(overlay()!.getAttribute('data-searching')).toBe('false')
    press({ key: 'Enter' })
    await settle(50)
    expect(fakes.adult.value).toBe(true)
    expect(fakes.opened).toEqual([])
    expect(fakes.chatJson).not.toHaveBeenCalled()
    await waitFor(() => overlay() === null)
  })

  it('范围胶囊默认「全部」：本地结果先出，在线结果异步追加在后面（同名同年多源合成一行），点在线行交给在线页', async () => {
    fakes.results = [{ key: 'a', title: '星际穿越', exact: false }]
    fakes.onlineItems = [
      { vod_name: '星际穿越', vod_year: '2014', source_name: '源甲' },
      { vod_name: '星际 穿越', vod_year: '2014', source_name: '源乙' },
      { vod_name: '星际旅行', vod_year: '2020', source_name: '源甲' },
    ]
    await openEntry()
    await type('星际')
    const chips = [
      ...document.querySelectorAll('.assistant-scopes [role="radio"]'),
    ]
    expect(chips.map(chip => chip.textContent?.trim())).toEqual([
      '全部',
      '本地',
      '在线',
    ])
    expect(chips[0].getAttribute('aria-checked')).toBe('true')
    // 在线等输入停下才搜
    expect(fakes.onlineSearches).toEqual([])
    expect(document.querySelectorAll('[data-search-result]')).toHaveLength(1)
    await settle(500)
    expect(fakes.onlineSearches).toEqual(['星际'])
    const rows = [...document.querySelectorAll('[data-search-result]')]
    expect(
      rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual([
      '星际穿越',
      '星际穿越 · 2014在线 · 源甲 等 2 个源',
      '星际旅行 · 2020在线 · 源甲',
    ])
    expect(rows[1].id).toBe('search-hit-1')
    ;(rows[1] as HTMLButtonElement).click()
    await waitFor(() => fakes.onlineOpened.length === 1)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('「本地」只搜片库、「在线」只搜在线源', async () => {
    fakes.results = [{ key: 'a', title: '甲', exact: false }]
    fakes.onlineItems = [{ vod_name: '乙', vod_year: '', source_name: '源' }]
    await openEntry()
    await type('甲')
    const chip = (label: string): HTMLButtonElement =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '.assistant-scopes [role="radio"]'
        ),
      ].find(el => el.textContent?.trim() === label)!
    chip('本地').click()
    await settle(500)
    expect(fakes.onlineSearches).toEqual([])
    expect(
      [...document.querySelectorAll('[data-search-result]')].map(
        row => row.textContent
      )
    ).toEqual(['甲'])
    chip('在线').click()
    await settle(500)
    expect(fakes.onlineSearches).toEqual(['甲'])
    const rows = [...document.querySelectorAll('[data-search-result]')]
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('乙')
    expect(rows[0].id).toBe('search-hit-0')
  })
})
