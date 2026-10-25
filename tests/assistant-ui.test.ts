// @vitest-environment jsdom
/**
 * AI 助手入口与浮层的挂载：openAssistant（侧栏 sparkle 入口）打开、Cmd/Ctrl+K 与全局快捷键事件唤起、
 * Esc / Esc 提示 / 点外部收起、未配置 AI 时显示「去设置 AI」；待命时只有玻璃输入胶囊、提问后展开成玻璃面板；
 * 播放器内右侧面板；普通模式 DOM 无敏感词（私密技能已登记也一样）；私密模式的胶囊与占位文字（不换色调）；
 * 私密模式切换时收起并清空对话上下文；窗口新建时取走待处理的唤起、收起后焦点回到打开前的元素、
 * 模态面板的焦点陷阱、按住 Cmd/Ctrl+K 的自动重复不算。AI、播放器、媒体库换成替身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const fakes = vi.hoisted(() => ({
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
  chatJson: vi.fn(),
  chatStream: vi.fn(),
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

beforeEach(() => {
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
  it('openAssistant 打开浮层：待命的玻璃输入胶囊、上下文胶囊、Esc 提示、输入框「问影盒…」、建议胶囊', async () => {
    await mount()
    expect(overlay()).toBeNull()
    openAssistant()
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-layout')).toBe('sheet')
    expect(overlay()!.getAttribute('data-expanded')).toBe('false')
    // 待命时面板本身没有玻璃，玻璃在输入胶囊上；没有光球与整圈边缘光
    expect(
      document.querySelector('.assistant-sheet')!.classList.contains('yb-glass')
    ).toBe(false)
    expect(
      document.querySelector('.assistant-field')!.classList.contains('yb-glass')
    ).toBe(true)
    expect(document.querySelector('.assistant-orb')).toBeNull()
    expect(document.querySelector('.edge-glow')).toBeNull()
    expect(document.querySelector('.assistant-streak')).not.toBeNull()
    expect(overlay()!.getAttribute('data-private')).toBe('false')
    expect(
      document.querySelector('.assistant-chip.is-context')?.textContent
    ).toContain('在线')
    expect(document.querySelector('.assistant-head')?.textContent).toContain(
      'deepseek-chat'
    )
    expect(document.querySelector('.assistant-esc')?.textContent).toBe('Esc')
    // 状态行只给读屏：待命未提问时为空，不与大标题重复
    expect(document.querySelector('.assistant-status')?.textContent).toBe('')
    expect(
      document.querySelector('.assistant-transcript')?.textContent
    ).toContain('有什么可以帮你')
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

  it('关闭按钮与点面板外收起', async () => {
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

  it('未配置 AI：提问后展开成玻璃面板并显示「去设置 AI」', async () => {
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
    expect(
      document.querySelector('.assistant-transcript')?.textContent
    ).toContain('今晚看什么')
    expect(document.querySelector('.assistant-setup')?.textContent).toContain(
      '去设置 AI'
    )
    expect(overlay()!.getAttribute('data-expanded')).toBe('true')
    expect(
      document.querySelector('.assistant-sheet')!.classList.contains('yb-glass')
    ).toBe(true)
    expect(
      document.querySelector('.assistant-field')!.classList.contains('yb-glass')
    ).toBe(false)
  })

  it('普通模式：DOM 里没有敏感词（私密技能已登记也不出现）', async () => {
    await mount()
    openAssistant()
    await waitFor(() => overlay() !== null)
    expect(document.body.textContent).not.toMatch(SENSITIVE)
    expect(document.body.innerHTML).not.toMatch(SENSITIVE)
  })

  it('私密模式：「私密 · 仅本地模型」、无痕提示、私密技能的建议与占位文字', async () => {
    await mount('/secret')
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-private')).toBe('true')
    expect(
      document.querySelector('.assistant-chip.is-context')?.textContent
    ).toContain('私密 · 仅本地模型')
    expect(document.querySelector('.assistant-head')?.textContent).toContain(
      '无痕'
    )
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

  it('内置播放器在前台时改为右侧面板，没有遮罩', async () => {
    fakes.player = { id: 1, payload: {}, minimized: false }
    await mount()
    key({ key: 'k', ctrlKey: true })
    await waitFor(() => overlay() !== null)
    expect(overlay()!.getAttribute('data-layout')).toBe('side')
    expect(document.querySelector('.assistant-scrim')).toBeNull()
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
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

  it('底部面板是模态：焦点被移到面板外时拉回面板', async () => {
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
        .querySelector('.assistant-sheet')!
        .contains(document.activeElement)
    ).toBe(true)
  })
})
