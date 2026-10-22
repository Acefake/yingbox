import { defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DownloadSnapshot,
  DownloadTask,
} from '../src/shared/contract/download'

/**
 * 下载列表的进度显示：知道总量时显示百分比和进度条；不知道总量（直链没有 Content-Length）时
 * 不显示百分比、进度条是不确定样式，只显示已下大小。
 * 虚拟列表换成直接渲染每一行的替身（SSR 下没有尺寸）。
 */
vi.mock('../src/renderer/src/components/ui/UiVirtualGrid.vue', () => ({
  default: defineComponent({
    props: { items: { type: Array, required: true } },
    setup(props, { slots }) {
      return () =>
        h(
          'ul',
          (props.items as DownloadTask[]).map(item => slots.default?.({ item }))
        )
    },
  }),
}))

const MB = 1024 * 1024

beforeEach(() => vi.resetModules())

/** 渲染只有一个进行中任务的下载列表（下载 API 用替身，快照同步给出）。 */
const render = async (active: DownloadTask): Promise<string> => {
  const snapshot: DownloadSnapshot = {
    active,
    queued: [],
    completed: [],
    failed: [],
  }
  vi.doMock('../src/renderer/src/features/download/api/download', () => ({
    ADD_REASON: {},
    useDownloads: () => ({
      available: true,
      snapshot: { value: snapshot },
      add: vi.fn(),
      remove: vi.fn(),
      retry: vi.fn(),
    }),
  }))
  const { default: DownloadsView } =
    await import('../src/renderer/src/features/download/components/DownloadsView.vue')
  return renderToString(h(DownloadsView))
}

describe('下载进度显示', () => {
  it('知道总量：百分比 + 已下大小，进度条有数值', async () => {
    const html = await render({
      id: 'A-1',
      status: 'active',
      progress: { done: 25, total: 100, bytes: 5 * MB },
      updatedAt: 1,
    })
    expect(html).toContain('下载中 25% · 5.0 MB')
    expect(html).toContain('aria-valuenow="25"')
    expect(html).not.toContain('is-indeterminate')
  })

  it('不知道总量：不显示百分比，进度条不确定，只显示已下大小', async () => {
    const html = await render({
      id: 'B-1',
      status: 'active',
      progress: { done: 12 * MB, bytes: 12 * MB },
      updatedAt: 1,
    })
    expect(html).toContain('下载中 · 12.0 MB')
    expect(html).not.toContain('%')
    expect(html).not.toContain('aria-valuenow')
    expect(html).toContain('is-indeterminate')
  })
})
