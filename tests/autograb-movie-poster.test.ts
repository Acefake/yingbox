// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import { policyOf } from '../src/shared/contract/grab-policy'
import type { MoviesOverview } from '../src/shared/contract/autograb-upgrade'
import MoviesPanel from '../src/renderer/src/features/autograb-upgrade/components/MoviesPanel.vue'

const { overview } = vi.hoisted(() => ({ overview: vi.fn() }))
vi.mock('../src/renderer/src/features/autograb-upgrade/api', () => ({
  autograbUpgradeAvailable: false,
  moviesApi: () => ({ overview, onChanged: () => {}, offChanged: () => {} }),
}))
vi.mock('@/services/thumbnails', () => ({
  thumbSrc: (src: string) => `thumb:${src}`,
  webImageSrc: (src: string) => src,
  pickThumbWidth: () => 300,
  applyFocus: vi.fn(),
}))
vi.mock('@/components/ui/hover-preview', () => ({ useCardPreview: vi.fn() }))

it('电影追踪海报的缩略图加载失败后回退原图，原图也失败才显示占位', async () => {
  const poster = 'https://image.tmdb.org/t/p/w342/movie.jpg'
  const data: MoviesOverview = {
    cid: '',
    cidName: '',
    policy: policyOf(undefined, 'movie'),
    defaultFolder: { cid: '0', name: '' },
    ready: { loggedIn: true, pansou: true, tmdb: true },
    pauseReason: null,
    running: false,
    movies: [
      {
        tmdbId: 1,
        title: '某电影',
        year: 2026,
        poster,
        releaseDate: null,
        dateSource: null,
        mode: 'auto',
        effectiveMode: 'auto',
        prefs: {},
        status: 'searching',
        attempts: 0,
        nextTry: null,
        candidates: [],
        error: null,
        addedAt: 0,
      },
    ],
  }
  overview.mockResolvedValue(data)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(MoviesPanel)
  app.directive('tooltip', {})
  app.mount(root)
  try {
    await vi.waitFor(() =>
      expect(root.querySelector('.ui-poster img')).not.toBeNull()
    )
    let image = root.querySelector<HTMLImageElement>('.ui-poster img')!
    expect(image.getAttribute('src')).toBe(`thumb:${poster}`)
    image.dispatchEvent(new Event('error'))
    await nextTick()
    image = root.querySelector<HTMLImageElement>('.ui-poster img')!
    expect(image?.getAttribute('src')).toBe(poster)
    image.dispatchEvent(new Event('error'))
    await nextTick()
    expect(root.querySelector('.ui-poster img')).toBeNull()
  } finally {
    app.unmount()
    root.remove()
  }
})
