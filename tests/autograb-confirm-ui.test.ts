// @vitest-environment jsdom
import { createApp, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutograbOverview } from '../src/shared/contract/autograb'
import { policyOf } from '../src/shared/contract/grab-policy'
import SeriesGrabSheet from '../src/renderer/src/features/autograb/components/SeriesGrabSheet.vue'

const ag = {
  overview: ref<AutograbOverview | null>(null),
  setSeries: vi.fn(async (_id: number, patch: unknown) => {
    structuredClone(patch)
    return true
  }),
  startSeries: vi.fn(async () => true),
  reload: vi.fn(async () => {}),
  busy: new Map(),
}
vi.mock('../src/renderer/src/features/autograb/use-autograb', () => ({
  useAutograb: () => ag,
}))
vi.mock('../src/renderer/src/features/autograb/use-series-posters', () => ({
  useSeriesPosters: () => ref(new Map()),
}))
vi.mock('../src/renderer/src/features/library', () => ({
  libraryImage: () => null,
}))

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

function mount(pending = true): ReturnType<typeof vi.fn> {
  const policy = policyOf(undefined, 'tv')
  ag.overview.value = {
    enabled: true,
    policy,
    prefs: policy.prefs,
    pausedUntil: null,
    pauseReason: null,
    spacePaused: null,
    ready: { loggedIn: true, pansou: true },
    today: { snaps: 0, receives: 0 },
    running: false,
    defaultFolder: { cid: '88', name: '剧集' },
    episodes: [],
    series: [
      {
        seriesId: 7,
        title: '某剧',
        pending,
        mode: 'confirm',
        effectiveMode: 'confirm',
        confirmFirst: 0,
        confirmed: 0,
        cid: '',
        cidName: '',
        prefs: {},
      },
    ],
  }
  const close = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(SeriesGrabSheet, { seriesId: 7, onClose: close })
  app.mount(root)
  unmount = () => app.unmount()
  return close
}

function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(
    el => el.textContent?.trim() === text
  )
  if (!result) throw new Error(`没有找到按钮：${text}`)
  return result
}

it('设置追更方式不立即保存；最终确认才保存并启动', async () => {
  const close = mount()
  button('全自动').click()
  await nextTick()
  expect(ag.setSeries).not.toHaveBeenCalled()
  expect(ag.startSeries).not.toHaveBeenCalled()
  button('确认并开始追剧').click()
  await vi.waitFor(() => expect(close).toHaveBeenCalled())
  expect(ag.setSeries).toHaveBeenCalledWith(7, { mode: 'auto' })
  expect(ag.startSeries).toHaveBeenCalledWith(7)
  expect(ag.setSeries.mock.invocationCallOrder[0]).toBeLessThan(
    ag.startSeries.mock.invocationCallOrder[0]
  )
})

it('取消未确认的任务会移除草稿，不启动追剧', async () => {
  const close = mount()
  button('取消').click()
  await vi.waitFor(() => expect(close).toHaveBeenCalled())
  expect(ag.setSeries).toHaveBeenCalledWith(7, { mode: 'off' })
  expect(ag.startSeries).not.toHaveBeenCalled()
})

it('偏好表单内输入后直接最终确认，也会保存当前偏好', async () => {
  const close = mount()
  button('单独设').click()
  await nextTick()
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="字幕组或片源，逗号分隔"]'
  )
  expect(input).not.toBeNull()
  input!.value = '测试字幕组'
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  button('确认并开始追剧').click()
  await vi.waitFor(() => expect(close).toHaveBeenCalled())
  expect(ag.setSeries).toHaveBeenCalledWith(7, {
    prefs: { preferWords: ['测试字幕组'] },
  })
  expect(ag.startSeries).toHaveBeenCalledWith(7)
})

it('关闭已有任务丢弃未保存的设置，不取消现有追剧', async () => {
  const close = mount(false)
  button('全自动').click()
  await nextTick()
  const dismiss =
    document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')
  expect(dismiss).not.toBeNull()
  dismiss!.click()
  await nextTick()
  expect(close).toHaveBeenCalled()
  expect(ag.setSeries).not.toHaveBeenCalled()
  expect(ag.startSeries).not.toHaveBeenCalled()
})
