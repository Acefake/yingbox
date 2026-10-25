// @vitest-environment jsdom
vi.mock('@/features/section-lock', () => ({ isPathLocked: () => false }))
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type {
  RecallBatch,
  SearchRequest,
  SearchScope,
} from '../../../src/renderer/src/features/library/search/types'

const { search, enhance, play, available } = vi.hoisted(() => ({
  search: vi.fn(),
  available: vi.fn(() => true),
  enhance: vi.fn(),
  play: vi.fn(),
}))
vi.mock(
  '../../../src/renderer/src/features/library/search/search-service',
  () => ({ searchLibrary: search, searchAvailable: available })
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
import { visualSearchSource } from '../../../src/renderer/src/features/library/visual/visual-source'

let app: App | null = null
const settle = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
beforeEach(() => {
  visualSearchSource.value = 'all'
  localStorage.clear()
  vi.useFakeTimers()
  vi.resetAllMocks()
  available.mockReturnValue(true)
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
  privateOnly = false,
  initialScope: SearchScope = 'all'
): Promise<{
  close: ReturnType<typeof vi.fn>
  router: ReturnType<typeof createRouter>
}> {
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
        initialScope,
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
  return { close, router }
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
  document
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  await settle()
  expect(search).toHaveBeenCalled()
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

it('CLIP 范围切换传到召回请求，并且不会触发 AI', async () => {
  await mount(true)
  const select = document.querySelector<HTMLSelectElement>(
    '[aria-label="CLIP 搜索范围"]'
  )!
  expect(select.value).toBe('all')
  select.value = 'video'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  expect(search.mock.lastCall?.[0].visualSource).toBe('video')
  expect(enhance).not.toHaveBeenCalled()
  select.value = 'image'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  expect(search.mock.lastCall?.[0].visualSource).toBe('image')
})

it('无结果时 combobox 不声明不存在的展开列表', async () => {
  await mount()
  const input = document.querySelector('input')!
  expect(input.getAttribute('aria-expanded')).toBe('false')
  expect(input.hasAttribute('aria-controls')).toBe(false)
})
it('本地不可用时有可见错误，在线搜索仍是可用的显式入口', async () => {
  available.mockReturnValue(false)
  search.mockRejectedValue(new Error('片库离线'))
  await mount()
  document
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  await settle()
  expect(document.body.textContent).toContain('片库离线')
  const online = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find(button => button.textContent?.includes('搜索在线资源'))!
  expect(online.disabled).toBe(false)
})
it('普通上下文不接受私密初始范围', async () => {
  await mount(false, 'jav')
  document
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  await settle()
  expect(search.mock.lastCall?.[0].scope).toBe('all')
})

it('结构化的配置缺失状态决定设置入口，而非文案关键词', async () => {
  const { SearchSetupError } =
    await import('../../../src/renderer/src/features/library/search/search-errors')
  localStorage.setItem('yingbox.search.ai', 'true')
  enhance.mockRejectedValue(new SearchSetupError('模型未就绪'))
  await mount()
  document
    .querySelector('input')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  await settle()
  expect(document.body.textContent).toContain('去设置 AI')
})
it('方向键和回车覆盖画面时刻及人物，控件引用的列表真实存在', async () => {
  search.mockImplementation(
    async (_request: SearchRequest, publish: (batch: RecallBatch) => void) => {
      publish({
        kind: 'visual',
        candidates: [
          {
            item: {
              id: 9,
              libraryId: 1,
              type: 'movie',
              title: '命中',
              originalTitle: null,
              year: null,
              matchState: 'locked',
              providerIds: {},
              poster: null,
              backdrop: null,
              rating: null,
              addedAt: 0,
              updatedAt: 0,
            },
            reason: '画面命中',
            visual: {
              itemId: 9,
              title: '命中',
              score: 1,
              image: 'img',
              frame: { fileId: 3, at: 10 },
            },
          },
        ],
      })
      publish({
        kind: 'people',
        candidates: [],
        actors: [
          { id: 12, name: '人物', photo: null, gender: null, workCount: 1 },
        ],
      })
    }
  )
  const { router } = await mount(true)
  const input = document.querySelector('input')!
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  )
  await settle()
  expect(
    document.getElementById(input.getAttribute('aria-controls')!)
  ).not.toBeNull()
  for (let i = 0; i < 3; i++)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    )
  await settle()
  expect(
    document.getElementById(input.getAttribute('aria-activedescendant')!)
      ?.textContent
  ).toContain('人物')
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  )
  await settle()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/jav'))
  expect(router.currentRoute.value.query.actor).toBe('12')
})
it('界面口令不提交本地、模型或在线检索', async () => {
  localStorage.setItem('yingbox.search.ai', 'true')
  const { router } = await mount()
  const input = document.querySelector<HTMLInputElement>('input')!
  input.value = 'getav'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  await vi.advanceTimersByTimeAsync(150)
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  )
  await settle()
  const online = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find(button => button.textContent?.includes('搜索在线资源'))!
  online.click()
  await settle()
  expect(search).not.toHaveBeenCalled()
  expect(enhance).not.toHaveBeenCalled()
  expect(router.currentRoute.value.path).toBe('/movie')
})
