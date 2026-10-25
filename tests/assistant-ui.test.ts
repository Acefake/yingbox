// @vitest-environment jsdom
/**
 * AI 助手入口与侧栏的挂载：openAssistant（侧栏 sparkle 入口）打开、Cmd/Ctrl+K 与全局快捷键事件唤起、
 * Esc / Esc 键帽 / 点遮罩收起、未配置 AI 时显示「去设置 AI」；右侧玻璃侧栏（普通页面模态 + 遮罩，
 * 播放器前台时没有遮罩、整层不拦点击、侧栏不做模态）；对话流（你说的话气泡、上一轮回答归档）；
 * 没有光球与边缘光圈；普通模式 DOM 无敏感词（私密技能已登记也一样）；私密模式的副标题与占位文字（不换色调）；
 * 私密模式切换或收起时清空对话上下文；窗口新建时取走待处理的唤起、收起后焦点回到打开前的元素、
 * 模态面板的焦点陷阱、按住 Cmd/Ctrl+K 的自动重复不算。AI、播放器、媒体库换成替身。
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
import { type App, createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const fakes = vi.hoisted(() => ({
  chatJson: vi.fn(),
  chatStream: vi.fn(),
  configured: true,
  player: null as unknown,
  summon: null as null | (() => void),
  pendingSummon: false,
  modal: null as null | { value: unknown },
}))

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
    playerModal: () => {
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

vi.mock('@/features/library', () => ({
  suggestTonight: vi.fn(),
  playTonightPick: vi.fn(),
}))

vi.mock('@/features/settings', () => ({
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

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

// 侧栏是异步组件：先把它的模块加载好，免得第一条用例在高负载下等第一次下载超时
beforeAll(async () => {
  await import('../src/renderer/src/features/assistant/AssistantOverlay.vue')
}, 30_000)

beforeEach(() => {
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
  it('openAssistant 打开侧栏：玻璃面板、标题、场景副标题、Esc 键帽、问候、输入框「问影盒…」、建议胶囊', async () => {
    await mount()
    expect(overlay()).toBeNull()
    openAssistant()
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-layout')).toBe('page')
    // 侧栏本身是玻璃，输入胶囊在面板里是内凹胶囊；没有光球与整圈边缘光，只有输入胶囊上沿的渐变
    expect(
      document
        .querySelector('.assistant-drawer')!
        .classList.contains('yb-glass')
    ).toBe(true)
    expect(
      document.querySelector('.assistant-field')!.classList.contains('yb-glass')
    ).toBe(false)
    expect(document.querySelector('.assistant-orb')).toBeNull()
    expect(document.querySelector('.edge-glow')).toBeNull()
    expect(document.querySelector('.assistant-streak')).not.toBeNull()
    expect(overlay()!.getAttribute('data-private')).toBe('false')
    expect(document.querySelector('.assistant-drawer')).not.toBeNull()
    expect(document.querySelector('.assistant-title')?.textContent).toBe(
      '影盒助手'
    )
    const subtitle = document.querySelector('.assistant-subtitle')
    expect(subtitle?.textContent?.trim()).toBe('在线 · 当前页面')
    expect(subtitle?.getAttribute('title')).toBe('deepseek-chat')
    expect(document.querySelector('.assistant-esc')?.textContent).toBe('Esc')
    // 状态行只给读屏：待命未提问时为空，不与问候重复
    expect(document.querySelector('.assistant-status')?.textContent).toBe('')
    expect(
      document.querySelector('.assistant-greeting')?.textContent
    ).toContain('有什么可以帮你')
    expect(document.querySelector('.assistant-bubble')).toBeNull()
    expect(
      document
        .querySelector('.assistant-input input')
        ?.getAttribute('placeholder')
    ).toBe('问影盒…')
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

  it('Ctrl+K 切换；全局快捷键事件（summon）打开', async () => {
    await mount()
    key({ key: 'k', ctrlKey: true })
    await settle()
    expect(overlay()).not.toBeNull()
    key({ key: 'k', ctrlKey: true })
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
    input.value = '今晚看什么'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await settle(50)
    expect(document.querySelector('.assistant-bubble')?.textContent).toContain(
      '今晚看什么'
    )
    expect(document.querySelector('.assistant-greeting')).toBeNull()
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
    const bubbles = [...document.querySelectorAll('.assistant-bubble')].map(
      el => el.textContent
    )
    expect(bubbles).toEqual(['第一句', '第二句'])
    const answers = [...document.querySelectorAll('.assistant-answer')].map(
      el => el.textContent?.trim()
    )
    expect(answers).toEqual(['回答 1', '回答 2'])
    // 第一轮已归档：它在第二轮的气泡前面，且不是「去设置 AI」那条说明
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

  it('私密模式：副标题「私密 · 仅本地模型 · 无痕」、私密技能的建议与占位文字', async () => {
    await mount('/secret')
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-private')).toBe('true')
    expect(
      document.querySelector('.assistant-subtitle')?.textContent
    ).toContain('私密 · 仅本地模型 · 无痕')
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
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    recordAssistantTurn('问', '答', true)
    await router.push('/')
    await settle(100)
    expect(overlay()).toBeNull()
    expect(assistantSessionSize()).toBe(0)
  })

  it('内置播放器在前台：同一个侧栏，没有遮罩、整层不拦点击、侧栏不做模态', async () => {
    fakes.player = { id: 1, payload: {}, minimized: false }
    await mount()
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-layout')).toBe('player')
    expect(document.querySelector('.assistant-drawer')).not.toBeNull()
    expect(
      document.querySelector('.assistant-drawer')!.getAttribute('aria-modal')
    ).toBe('false')
    // 不拦点击：没有遮罩元素；整层 pointer-events: none 的样式约束见 assistant-drawer.test.ts
    expect(document.querySelector('.assistant-scrim')).toBeNull()
    // 不拦焦点：焦点移到侧栏外（播放器控件）后不会被拉回
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

  it('私密模式下收起侧栏：清空对话上下文（关掉就不留记录）', async () => {
    await mount('/secret')
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    recordAssistantTurn('问', '答', true)
    expect(assistantSessionSize()).toBe(1)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
    expect(assistantSessionSize()).toBe(0)
  })

  it('普通模式下收起侧栏：对话上下文保留', async () => {
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

  it('按住 Cmd/Ctrl+K 的自动重复不反复开合', async () => {
    await mount()
    key({ key: 'k', ctrlKey: true })
    await settle()
    key({ key: 'k', ctrlKey: true, repeat: true })
    await settle(100)
    expect(overlay()).not.toBeNull()
  })

  it('普通页面的侧栏是模态：焦点被移到侧栏外时拉回侧栏', async () => {
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    await mount()
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    await settle(50)
    outside.focus()
    await settle()
    expect(
      document
        .querySelector('.assistant-drawer')!
        .contains(document.activeElement)
    ).toBe(true)
  })
})
