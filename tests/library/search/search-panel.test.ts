// @vitest-environment jsdom
vi.mock('@/features/section-lock', () => ({ isPathLocked: () => false }))
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type {
  RecallBatch,
  SearchRequest,
} from '../../../src/renderer/src/features/library/search/types'

const { search, enhance, play } = vi.hoisted(() => ({
  search: vi.fn(),
  enhance: vi.fn(),
  play: vi.fn(),
}))
vi.mock(
  '../../../src/renderer/src/features/library/search/search-service',
  () => ({ searchLibrary: search, searchAvailable: () => true })
)
vi.mock(
  '../../../src/renderer/src/features/library/search/ai-conditions',
  () => ({ enhanceConditions: enhance })
)
vi.mock(
  '../../../src/renderer/src/features/library/detail/assistant-links',
  () => ({ libraryPoster: () => null })
)
vi.mock(
  '../../../src/renderer/src/features/library/visual/play-moment',
  () => ({ playMoment: play })
)
vi.mock('../../../src/renderer/src/features/library/api/bridge', () => ({
  errorText: (error: Error) => error.message,
}))
import Panel from '../../../src/renderer/src/features/library/search/UnifiedSearchPanel.vue'

let app: App | null = null
const settle = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.resetAllMocks()
  search.mockResolvedValue(undefined)
  enhance.mockResolvedValue({ genres: ['科幻'] })
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

async function mount(
  privateOnly = false
): Promise<{ close: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  await router.push('/movie')
  await router.isReady()
  const text = ref('星际穿越'),
    close = vi.fn()
  app = createApp({
    setup: () => () =>
      h(Panel, {
        initialScope: 'all',
        privateOnly,
        text: text.value,
        'onUpdate:text': (value: string) => {
          text.value = value
        },
        onClose: close,
      }),
  })
  app.use(router)
  app.mount(host)
  await settle()
  return { close }
}

it('聚焦搜索框、默认关闭 AI，中文组字回车不提交，普通回车只查本地', async () => {
  await mount()
  const input = document.querySelector<HTMLInputElement>(
    '.unified-search input[type="text"]'
  )!
  expect(document.activeElement).toBe(input)
  expect(
    document.querySelector<HTMLInputElement>('[role="switch"]')!.checked
  ).toBe(false)
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
    })
  )
  expect(search).not.toHaveBeenCalled()
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  )
  await settle()
  expect(search).toHaveBeenCalled()
  expect(enhance).not.toHaveBeenCalled()
})
it('开启 AI 不立即请求，回车才解析；私密范围强制关闭保存的 AI 偏好', async () => {
  localStorage.setItem('yingbox.search.ai', 'true')
  await mount(true)
  const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')!
  expect(toggle.disabled).toBe(true)
  expect(toggle.checked).toBe(false)
  document
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  await settle()
  expect(enhance).not.toHaveBeenCalled()
  expect(search.mock.calls[0][0].scope).toBe('jav')
})
it('画面时间点沿用命中的版本文件，关闭面板后播放', async () => {
  search.mockImplementation(
    async (_request: SearchRequest, publish: (batch: RecallBatch) => void) =>
      publish({
        kind: 'visual',
        candidates: [
          {
            item: {
              id: 9,
              libraryId: 1,
              type: 'movie',
              title: '画面影片',
              originalTitle: null,
              year: 2020,
              matchState: 'locked',
              providerIds: {},
              poster: null,
              backdrop: null,
              rating: null,
              addedAt: 0,
              updatedAt: 0,
            },
            reason: '画面命中 · 2:30',
            visual: {
              itemId: 9,
              title: '画面影片',
              score: 0.8,
              image: 'frame',
              frame: { fileId: 42, at: 150 },
            },
          },
        ],
      })
  )
  const { close } = await mount(true)
  await vi.advanceTimersByTimeAsync(150)
  await settle()
  const rows = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-search-result]'),
  ]
  rows.find(row => row.textContent?.includes('点击从此处播放'))!.click()
  expect(close).toHaveBeenCalledOnce()
  expect(play).toHaveBeenCalledWith(9, 42, 150)
})
it('AI 关闭和开启都不会因输入变化自动发云端请求', async () => {
  await mount()
  const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')!
  toggle.checked = true
  toggle.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  expect(enhance).not.toHaveBeenCalled()
  document
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  await settle()
  expect(enhance).toHaveBeenCalledOnce()
})

it('面板卸载后恢复打开前的焦点', async () => {
  const previous = document.createElement('button')
  document.body.append(previous)
  previous.focus()
  await mount()
  expect(document.activeElement).not.toBe(previous)
  app!.unmount()
  app = null
  expect(document.activeElement).toBe(previous)
})
