// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
const chat = vi.hoisted(() => vi.fn())
vi.mock('@/features/ai', () => ({
  AiCallError: class extends Error {},
  aiAvailable: () => false,
  aiConfigured: () => false,
  aiKeyConfigured: () => false,
  chatJson: chat,
}))
vi.mock('@/features/settings', () => ({ useSetting: () => ref('') }))
vi.mock('@/features/player', () => ({ continueRecords: () => ref([]) }))
vi.mock('../../../src/renderer/src/features/library/api/bridge', () => ({
  libraryBridge: () => ({ facets: { list: async () => [] } }),
}))
import { useNlSearch } from '../../../src/renderer/src/features/library/nl-search/use-nl-search'
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})
it('首次挂载应用 URL 条件，文字变化保留编辑过的胶囊，全程不调用模型', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/movie', component: { render: () => null } }],
  })
  await router.push({
    path: '/movie',
    query: {
      q: '高分电影',
      searchFilter: JSON.stringify({ yearFrom: 1990, ratingMin: 8 }),
    },
  })
  await router.isReady()
  let nl!: ReturnType<typeof useNlSearch>
  app = createApp({
    setup() {
      nl = useNlSearch('movie', () => ({ source: 'tmdb', types: ['movie'] }))
      return () => h('div')
    },
  })
  app.use(router)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  await nextTick()
  expect(nl.query()).toMatchObject({ yearFrom: 1990, ratingMin: 8 })
  const years = nl.chips.value.find(chip => chip.field === 'years')!
  nl.remove(years)
  await router.replace({
    path: '/movie',
    query: { ...router.currentRoute.value.query, q: '换一段描述' },
  })
  await nextTick()
  expect(nl.query().yearFrom).toBeUndefined()
  expect(nl.query().ratingMin).toBe(8)
  expect(chat).not.toHaveBeenCalled()
})
