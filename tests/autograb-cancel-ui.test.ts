// @vitest-environment jsdom
import { createApp } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { AutograbEpisode } from '../src/shared/contract/autograb'
import PendingList from '../src/renderer/src/features/autograb/components/PendingList.vue'

vi.mock('../src/renderer/src/features/library', () => ({
  libraryImage: () => null,
}))
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
})

const episode: AutograbEpisode = {
  key: '7:1:1',
  seriesId: 7,
  seriesTitle: '某剧',
  season: 1,
  episode: 1,
  airDate: '2026-11-01',
  status: 'notFound',
  attempts: 2,
  nextTry: null,
  candidates: [],
  error: 'PanSou 没有搜到分享',
  notified: false,
  revertable: false,
}

function mount(
  stopping = new Set<number>(),
  episodes = [episode]
): {
  open: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  grabBest: ReturnType<typeof vi.fn>
} {
  const open = vi.fn()
  const stop = vi.fn()
  const grabBest = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(PendingList, {
    episodes,
    posters: new Map(),
    series: new Map(),
    busy: new Map(),
    grabbingAll: false,
    stopping,
    onOpenSeries: open,
    onStop: stop,
    onGrabBest: grabBest,
  })
  app.mount(root)
  unmount = () => app.unmount()
  return { open, stop, grabBest }
}

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll('button')].find(
    item => item.textContent?.trim() === text
  )
  if (!element) throw new Error(`没有找到按钮：${text}`)
  return element
}

it('找不到资源仍以整部剧展示，详情和取消都使用剧 id', () => {
  const { open, stop } = mount()
  button('追剧详情').click()
  expect(open).toHaveBeenCalledWith(7)
  expect(document.body.textContent).not.toContain('跳过本集')
  expect(stop).not.toHaveBeenCalled()
  button('取消追剧').click()
  expect(stop).toHaveBeenCalledWith(7)
})

it('整部取消进行中时，阻止重复取消', () => {
  const { stop } = mount(new Set([7]))
  expect(button('取消追剧').getAttribute('aria-busy')).toBe('true')
  button('取消追剧').click()
  expect(stop).not.toHaveBeenCalled()
})

it('全部转存排除正在取消追剧的候选', () => {
  const episodes = [7, 8, 9].map(seriesId => ({
    ...episode,
    key: `${seriesId}:1:1`,
    seriesId,
    status: 'found' as const,
    candidates: [
      {
        shareUrl: 'https://115.com/s/test',
        password: '',
        shareTitle: '某剧',
        fileId: '1',
        fileName: '某剧.S01E01.mkv',
        size: 1,
        score: 90,
        quality: 90,
        specs: [],
        reasons: [],
      },
    ],
  }))
  const { grabBest } = mount(new Set([7]), episodes)
  button('全部转存缺集（2 集）').click()
  expect(grabBest).toHaveBeenCalledWith(['8:1:1', '9:1:1'])
})

it('同剧多个缺集只显示一张卡，一次操作覆盖本剧全部推荐候选', () => {
  const episodes = [1, 2, 3].map(n => ({
    ...episode,
    key: `7:1:${n}`,
    episode: n,
    status: 'found' as const,
    candidates: [
      {
        shareUrl: 'https://115.com/s/test',
        password: '',
        shareTitle: '某剧全集',
        fileId: String(n),
        fileName: `某剧.S01E0${n}.mkv`,
        size: 1,
        score: 90,
        quality: 90,
        specs: [],
        reasons: [],
      },
    ],
  }))
  const { grabBest } = mount(new Set(), episodes)
  expect(document.querySelectorAll('.ag-task')).toHaveLength(1)
  expect(document.body.textContent).toContain('1 部')
  expect(document.body.textContent).toContain('某剧全集')
  button('转存本剧缺集（3 集）').click()
  expect(grabBest).toHaveBeenCalledWith(['7:1:1', '7:1:2', '7:1:3'])
})
