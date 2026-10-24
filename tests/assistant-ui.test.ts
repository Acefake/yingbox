// @vitest-environment jsdom
/**
 * AI 助手入口与浮层的挂载：光球按钮打开、Cmd/Ctrl+K 与全局快捷键事件唤起、Esc / 关闭按钮 / 点外部收起、
 * 未配置 AI 时显示「去设置 AI」、播放弹窗在时不显示光球。AI、播放器、媒体库换成替身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type App,
  createApp,
  defineComponent,
  h,
  nextTick,
  shallowRef,
} from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const fakes = vi.hoisted(() => ({
  configured: true,
  player: null as unknown,
  summon: null as null | (() => void),
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
      modal.value = fakes.player
      return modal
    },
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
      : key === 'ai.speech.engine'
        ? 'off'
        : '',
}))

import AssistantLauncher from '../src/renderer/src/features/assistant/AssistantLauncher.vue'

let app: App | null = null
let host: HTMLElement

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

async function mount(): Promise<void> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => h('div') } }],
  })
  await router.push('/')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(defineComponent({ render: () => h(AssistantLauncher) }))
  app.use(router)
  app.mount(host)
  await nextTick()
}

const overlay = (): Element | null => document.querySelector('.assistant')
const fab = (): HTMLElement | null => document.querySelector('.assistant-fab')

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
}

beforeEach(() => {
  fakes.configured = true
  fakes.player = null
  fakes.summon = null
  ;(window as unknown as { api: unknown }).api = {
    assistant: {
      onSummon: (cb: () => void) => {
        fakes.summon = cb
      },
      offSummon: vi.fn(),
    },
  }
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('AssistantLauncher', () => {
  it('点光球打开浮层：光球、状态、输入框「问影盒…」、建议胶囊', async () => {
    await mount()
    expect(overlay()).toBeNull()
    fab()!.click()
    await waitFor(() => overlay() !== null)
    expect(
      document.querySelector('.assistant-orb')?.getAttribute('data-phase')
    ).toBe('idle')
    expect(document.querySelector('.edge-glow')).not.toBeNull()
    expect(document.querySelector('.assistant-status')?.textContent).toContain(
      '有什么可以帮你'
    )
    expect(
      document
        .querySelector('.assistant-input input')
        ?.getAttribute('placeholder')
    ).toBe('问影盒…')
    expect(
      document.querySelectorAll('.assistant-suggestions .ui-chip').length
    ).toBe(4)
    expect(fab()).toBeNull()
  })

  it('Esc 收起浮层', async () => {
    await mount()
    fab()!.click()
    await waitFor(() => overlay() !== null)
    key({ key: 'Escape' })
    await settle(100)
    expect(overlay()).toBeNull()
  })

  it('关闭按钮与点面板外收起', async () => {
    await mount()
    fab()!.click()
    await settle()
    ;(document.querySelector('.assistant-close') as HTMLElement).click()
    await settle(100)
    expect(overlay()).toBeNull()
    fab()!.click()
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

  it('未配置 AI：提问后显示「去设置 AI」', async () => {
    fakes.configured = false
    await mount()
    fab()!.click()
    await settle()
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
  })

  it('播放弹窗在时不显示光球', async () => {
    fakes.player = shallowRef({ id: 1 })
    await mount()
    expect(fab()).toBeNull()
  })
})
