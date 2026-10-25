// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 测试里就地拼外壳与页面 */
import {
  type App,
  KeepAlive,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
} from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import {
  pageOwnsBack,
  useOwnBackButton,
} from '../src/renderer/src/composables/use-shell-chrome'

/**
 * 外壳与自带返回键页面的约定（use-shell-chrome）：挂载、keep-alive 停用 / 再激活、卸载时计数成对增减，
 * 重复激活不多记，最后 pageOwnsBack 回到 false，不泄漏。
 */

const apps: App[] = []

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** 自带返回键的页面 */
const Detail = defineComponent({
  name: 'Detail',
  setup() {
    useOwnBackButton()
    return () => h('div', 'detail')
  },
})
/** 普通页面 */
const Plain = defineComponent({
  name: 'Plain',
  setup: () => () => h('div', 'plain'),
})

/** 挂一个 keep-alive 外壳，page 决定显示哪页，shown 为 false 时整块卸载 */
function mountShell(): {
  page: ReturnType<typeof ref<'detail' | 'plain'>>
  shown: ReturnType<typeof ref<boolean>>
} {
  const page = ref<'detail' | 'plain'>('detail')
  const shown = ref(true)
  const app = createApp({
    setup: () => () =>
      shown.value
        ? h(KeepAlive, null, [page.value === 'detail' ? h(Detail) : h(Plain)])
        : null,
  })
  const el = document.createElement('div')
  document.body.appendChild(el)
  app.mount(el)
  apps.push(app)
  return { page, shown }
}

describe('useOwnBackButton', () => {
  it('挂载时登记，卸载时撤销', async () => {
    const { shown } = mountShell()
    await nextTick()
    expect(pageOwnsBack.value).toBe(true)
    shown.value = false
    await nextTick()
    expect(pageOwnsBack.value).toBe(false)
  })

  it('keep-alive 停用撤销、再激活重新登记，反复切换不累计', async () => {
    const { page, shown } = mountShell()
    await nextTick()
    for (let i = 0; i < 3; i++) {
      page.value = 'plain'
      await nextTick()
      expect(pageOwnsBack.value).toBe(false)
      page.value = 'detail'
      await nextTick()
      expect(pageOwnsBack.value).toBe(true)
    }
    // 停用状态下整块卸载：不会再减一次
    page.value = 'plain'
    await nextTick()
    shown.value = false
    await nextTick()
    expect(pageOwnsBack.value).toBe(false)
  })

  it('两个页面同时登记时，卸掉一个仍算有页面自带返回键', async () => {
    const a = mountShell()
    mountShell()
    await nextTick()
    a.shown.value = false
    await nextTick()
    expect(pageOwnsBack.value).toBe(true)
    for (const app of apps.splice(0)) app.unmount()
    expect(pageOwnsBack.value).toBe(false)
  })
})
