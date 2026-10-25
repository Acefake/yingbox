/**
 * 库外发现 · 首页弹窗的命令式打开：连点时只留最后一次打开的弹窗，前一个能被关掉，不留孤儿。
 * vue 的 h / render、document 与弹窗组件加载器都换成替身（测试环境是 node）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rendered = vi.hoisted(
  () => [] as Array<{ vnode: unknown; container: unknown }>
)

// 只替换 h / render，不真的挂载
vi.mock('vue', async importOriginal => ({
  ...(await importOriginal<typeof import('vue')>()),
  h: (component: unknown, props: Record<string, unknown>) => ({
    component,
    props,
  }),
  render: (vnode: unknown, container: unknown) =>
    void rendered.push({ vnode, container }),
}))

import type { DiscoverTitle } from '../src/renderer/src/features/discover/discover-rules'
import { createDialogOpener } from '../src/renderer/src/features/discover/open-dialog'

interface FakeContainer {
  removed: boolean
  remove(): void
}

const title = (doubanId: string): DiscoverTitle => ({
  doubanId,
  kind: 'movie',
  title: `片子 ${doubanId}`,
  originalTitle: '',
  year: 2014,
  rate: '9.0',
  cover: '',
  tmdbId: null,
})

let containers: FakeContainer[] = []

beforeEach(() => {
  rendered.length = 0
  containers = []
  vi.stubGlobal('document', {
    createElement: (): FakeContainer => {
      const el: FakeContainer = {
        removed: false,
        remove() {
          el.removed = true
        },
      }
      containers.push(el)
      return el
    },
    body: { appendChild: () => {} },
  })
})

afterEach(() => vi.unstubAllGlobals())

/** 当前挂着（没被卸载）的弹窗容器 */
const mounted = (): FakeContainer[] => containers.filter(c => !c.removed)

describe('首页弹窗 openDiscoverDialog', () => {
  /** 每个用例一个新的打开函数；组件加载器是替身（异步，模拟按需加载） */
  let openDiscoverDialog: ReturnType<typeof createDialogOpener>
  beforeEach(() => {
    openDiscoverDialog = createDialogOpener(async () => ({
      name: 'DiscoverDialog',
    }))
  })

  it('并发打开两次：只渲染最后一次，不留孤儿弹窗', async () => {
    await Promise.all([
      openDiscoverDialog(title('a')),
      openDiscoverDialog(title('b')),
    ])
    expect(mounted()).toHaveLength(1)
    const shown = rendered.filter(r => r.vnode !== null)
    expect(shown).toHaveLength(1)
    const props = (shown[0].vnode as { props: { target: DiscoverTitle } }).props
    expect(props.target.doubanId).toBe('b')
  })

  it('再打开一个会关掉上一个；关闭回调可以重复调用', async () => {
    await openDiscoverDialog(title('a'))
    const first = rendered.at(-1)?.vnode as { props: { onClose(): void } }
    await openDiscoverDialog(title('b'))
    expect(mounted()).toHaveLength(1)
    // 已被替换的弹窗再调关闭不影响当前这个
    first.props.onClose()
    expect(mounted()).toHaveLength(1)
    const second = rendered.at(-1)?.vnode as { props: { onClose(): void } }
    second.props.onClose()
    second.props.onClose()
    expect(mounted()).toHaveLength(0)
  })
})
