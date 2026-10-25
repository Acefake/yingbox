// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
vi.mock('@/features/settings', () => ({ useSetting: () => ref(false) }))
vi.mock('@/features/library', () => ({
  UnifiedSearchPanel: { render: () => null },
}))
vi.mock('@/features/player', () => ({ playerModal: () => ref(null) }))
vi.mock('@/composables/use-platform', () => ({
  usePlatform: () => ({ isPhone: ref(false), isElectron: ref(false) }),
}))
import Sidebar from '../../../src/renderer/src/features/shell/components/SidebarSearch.vue'
let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})
it('侧栏清空同步去掉 URL 搜索及交接条件，同时保留其他路由信息', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/movie', name: 'Movie', component: { render: () => null } },
    ],
  })
  await router.push({
    path: '/movie',
    query: { q: '旧词', searchFilter: '{}', item: '7' },
  })
  await router.isReady()
  app = createApp({ render: () => h(Sidebar, { collapsed: false }) })
  app.use(router)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  await nextTick()
  document.querySelector<HTMLButtonElement>('[aria-label="清空搜索"]')!.click()
  await vi.waitFor(() => {
    expect(router.currentRoute.value.query.q).toBeUndefined()
    expect(router.currentRoute.value.query.searchFilter).toBeUndefined()
  })
  expect(router.currentRoute.value.query.item).toBe('7')
})
