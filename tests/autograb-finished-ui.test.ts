// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutograbSeries } from '../src/shared/contract/autograb'
import TrackedSeriesList from '../src/renderer/src/features/autograb/components/TrackedSeriesList.vue'

vi.mock('../src/renderer/src/features/library', () => ({
  libraryImage: () => null,
}))
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
})

const series = (seriesId: number): AutograbSeries => ({
  seriesId,
  title: `剧${seriesId}`,
  mode: 'inherit',
  effectiveMode: 'auto',
  confirmFirst: 0,
  cid: '',
  cidName: '',
  confirmed: 0,
  prefs: {},
  nextAirDate: null,
})

function mount(finished: number[]): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(TrackedSeriesList, {
    tracked: [series(1), series(2), series(3)],
    posters: new Map(),
    pending: new Map(),
    finished: new Set(finished),
  })
  app.mount(root)
  unmount = () => app.unmount()
  return root
}


it('存完的剧默认收起，点「展开已存完」后出现在后面', async () => {
  const root = mount([2, 3])
  expect(root.textContent).toContain('1 部')
  expect(root.textContent).not.toContain('剧2')
  const toggle = [...root.querySelectorAll('button')].find(b =>
    b.textContent?.includes('已存完 2 部')
  )
  expect(toggle).toBeTruthy()
  toggle!.click()
  await nextTick()
  expect(root.textContent).toContain('剧2')
  expect(root.textContent).toContain('剧3')
  expect(root.textContent).toContain('已存完')
})

it('全部存完时仍有展开按钮，不显示「还没有在追的剧」', () => {
  const root = mount([1, 2, 3])
  expect(root.textContent).not.toContain('还没有在追的剧')
  expect(root.textContent).toContain('展开已存完 3 部')
})
