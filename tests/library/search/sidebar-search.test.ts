// @vitest-environment jsdom
/**
 * 侧栏统一入口（看起来是搜索框的按钮）打开居中浮层；海报墙条件条上的「搜索 …」胶囊清除 ?q= 与交接条件。
 */
import { afterEach, expect, it, vi } from 'vitest'
import { type App, computed, createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
const { open } = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@/features/assistant', () => ({
  ENTRY_HOTKEY_LABEL: 'Ctrl K',
  assistantOpen: ref(false),
  openAssistant: open,
}))
vi.mock('@/features/ai', () => ({ aiAvailable: () => true }))
vi.mock('@/composables/use-platform', () => ({
  usePlatform: () => ({ isPhone: ref(false), isElectron: ref(false) }),
}))
import Sidebar from '../../../src/renderer/src/features/shell/components/SidebarSearch.vue'
import NlSearchBar from '../../../src/renderer/src/features/library/nl-search/NlSearchBar.vue'
import type { NlSearch } from '../../../src/renderer/src/features/library/nl-search/use-nl-search'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  open.mockReset()
})

async function mount(
  render: () => ReturnType<typeof h>,
  query: Record<string, string> = {}
): Promise<ReturnType<typeof createRouter>> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/movie', name: 'Movie', component: { render: () => null } },
    ],
  })
  await router.push({ path: '/movie', query })
  await router.isReady()
  app = createApp({ render })
  app.use(router)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  await nextTick()
  return router
}

it('侧栏入口是一个按钮：写「搜索或问 AI」+ 快捷键，点它打开统一入口；收起时只剩放大镜', async () => {
  await mount(() => h(Sidebar, { collapsed: false }))
  const button = document.querySelector<HTMLButtonElement>('.sidebar-search')!
  expect(button.tagName).toBe('BUTTON')
  expect(button.getAttribute('aria-label')).toBe('搜索或问 AI（Ctrl K）')
  expect(button.getAttribute('aria-haspopup')).toBe('dialog')
  expect(button.textContent).toContain('Ctrl K')
  expect(document.querySelector('input')).toBeNull()
  button.click()
  expect(open).toHaveBeenCalledOnce()
  app!.unmount()
  await mount(() => h(Sidebar, { collapsed: true }))
  document.querySelector<HTMLButtonElement>('.sidebar-tool')!.click()
  expect(open).toHaveBeenCalledTimes(2)
})

it('海报墙条件条：清除搜索去掉 URL 搜索及交接条件，同时保留其他路由信息', async () => {
  const nl = {
    active: computed(() => false),
    canAsk: computed(() => true),
    chips: computed(() => []),
    status: ref('idle'),
    message: ref(''),
    ask: vi.fn(),
  } as unknown as NlSearch
  const router = await mount(() => h(NlSearchBar, { nl }), {
    q: '旧词',
    searchFilter: '{}',
    item: '7',
  })
  expect(document.querySelector('.nl-bar-query')?.textContent).toContain('旧词')
  document.querySelector<HTMLButtonElement>('[aria-label="清除搜索"]')!.click()
  await vi.waitFor(() => {
    expect(router.currentRoute.value.query.q).toBeUndefined()
    expect(router.currentRoute.value.query.searchFilter).toBeUndefined()
  })
  expect(router.currentRoute.value.query.item).toBe('7')
})
