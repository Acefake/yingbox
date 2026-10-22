// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 测试里就地拼替身组件 */
import {
  type Component,
  createApp,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
} from 'vue'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 在线页（OnlineView）作为小窗宿主的接线：
 * - 播放中关闭详情（返回键 / 切标签）→ 在详情卸载之前调 leave()，<video> 还在文档里；
 * - 进小窗那一刻 capture() 记下当前条目；「回到详情」重新打开这个条目并让详情认领小窗；
 * - 没有打开详情时 capture() 不给恢复函数。
 * 子组件都换成替身，只看 OnlineView 自己的接线。详情外面包着 <Transition>，jsdom 里离场节点会多留一会儿，
 * 所以按挂载 / 卸载钩子的顺序判断，不看 DOM 里还有没有详情。
 */

const order: string[] = []
const resumeMini = vi.fn()
let capture: (() => (() => void) | undefined) | undefined
const leave = vi.fn(() => order.push('leave'))

vi.mock('../src/renderer/src/features/player', () => ({
  getMediaProgress: () => 0,
  openMediaPlayer: async () => true,
  provideMiniHost: (options: { capture?: typeof capture }) => {
    capture = options.capture
    return { leave }
  },
}))

const stub = (name: string, emits: string[] = []): Component =>
  defineComponent({ name, emits, setup: () => () => h('div') })

let openDouban: ((item: unknown) => void) | undefined
vi.mock(
  '../src/renderer/src/features/online/components/DoubanSection.vue',
  () => ({
    default: defineComponent({
      name: 'DoubanSection',
      emits: ['open'],
      setup(_, { emit }) {
        openDouban = item => emit('open', item)
        return () => h('div')
      },
    }),
  })
)
vi.mock('../src/renderer/src/features/online/components/SearchTab.vue', () => ({
  default: stub('SearchTab', ['open-item']),
}))
vi.mock('../src/renderer/src/features/online/components/VodBrowse.vue', () => ({
  default: stub('VodBrowse', ['open-item']),
}))
vi.mock(
  '../src/renderer/src/features/online/components/LibraryCollection.vue',
  () => ({ default: stub('LibraryCollection', ['open', 'resume']) })
)
vi.mock(
  '../src/renderer/src/features/online/components/DetailWindow.vue',
  () => ({
    default: defineComponent({
      name: 'DetailWindow',
      props: { item: { type: Object, default: null } },
      setup(props, { expose }) {
        expose({ resumeMini })
        onMounted(() => order.push(`mount:${props.item?.vod_name}`))
        onBeforeUnmount(() => order.push('unmount'))
        return () =>
          h('div', { class: 'detail-stub' }, String(props.item?.vod_name))
      },
    }),
  })
)
vi.mock('../src/renderer/src/components/ui', () => ({
  toast: { error: vi.fn() },
}))

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function mountOnline(): Promise<{
  router: ReturnType<typeof createRouter>
  root: HTMLElement
}> {
  const { default: OnlineView } =
    await import('../src/renderer/src/features/online/views/OnlineView.vue')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: OnlineView as Component }],
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  await router.push('/')
  await router.isReady()
  createApp(defineComponent({ setup: () => () => h(RouterView) }))
    .use(router)
    .mount(root)
  await settle()
  return { router, root }
}

beforeEach(() => {
  order.length = 0
  leave.mockClear()
  resumeMini.mockClear()
  capture = undefined
  openDouban = undefined
  document.body.innerHTML = ''
})

describe('OnlineView 小窗宿主接线', () => {
  it('没打开详情时 capture 不给恢复函数', async () => {
    await mountOnline()
    expect(capture).toBeTypeOf('function')
    expect(capture?.()).toBeUndefined()
  })

  it('返回键关闭详情：先 leave()，再卸载详情', async () => {
    await mountOnline()
    openDouban?.({ title: '繁花', cover: '', type: 'tv' })
    await settle()
    expect(order).toEqual(['mount:繁花'])

    window.dispatchEvent(new Event('app:navigate-back', { cancelable: true }))
    await settle()
    expect(leave).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['mount:繁花', 'leave', 'unmount'])
  })

  it('切标签关闭详情也交给小窗', async () => {
    const { router } = await mountOnline()
    openDouban?.({ title: '繁花', cover: '', type: 'tv' })
    await settle()
    await router.push('/?tab=search')
    await settle()
    expect(leave).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['mount:繁花', 'leave', 'unmount'])
  })

  it('回到详情：重新打开进小窗时的条目，并让详情认领小窗', async () => {
    await mountOnline()
    openDouban?.({ title: '繁花', cover: '', type: 'tv' })
    await settle()
    const restore = capture?.()
    expect(restore).toBeTypeOf('function')

    window.dispatchEvent(new Event('app:navigate-back', { cancelable: true }))
    await settle()
    expect(order.at(-1)).toBe('unmount')
    expect(resumeMini).not.toHaveBeenCalled()

    restore?.()
    await settle()
    expect(order.at(-1)).toBe('mount:繁花')
    expect(resumeMini).toHaveBeenCalledTimes(1)
  })

  it('打开别的条目时 leave 不触发（只在详情关闭时）', async () => {
    await mountOnline()
    openDouban?.({ title: '繁花', cover: '', type: 'tv' })
    await settle()
    openDouban?.({ title: '漫长的季节', cover: '', type: 'tv' })
    await settle()
    expect(leave).not.toHaveBeenCalled()
  })
})
