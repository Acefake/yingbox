/**
 * 网盘页离线下载的交互（组合函数，node 环境直接跑）：未登录引导去设置、防重复点击、成功 / 已存在 / 失败的提示；
 * 离线任务的状态文字与说明。
 */
import { describe, expect, it, vi } from 'vitest'

import { useOfflineAdd } from '../../src/renderer/src/features/netdisk/composables/use-offline'
import {
  offlineMeta,
  offlineStatusLabel,
} from '../../src/renderer/src/features/netdisk/utils/netdisk-rules'
import type { OfflineTask } from '../../src/shared/contract/offline'
import type { MagnetItem } from '../../src/shared/contract/pan115'

const ITEM: MagnetItem = {
  title: 'Some.Movie.2024',
  origin: 'torznab',
  source: 'YTS',
  kind: 'magnet',
  link: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
  hash: 'a'.repeat(40),
}

function setup(add: ReturnType<typeof vi.fn>): {
  actions: ReturnType<typeof useOfflineAdd>
  notify: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  openLogin: ReturnType<typeof vi.fn>
} {
  const notify = { success: vi.fn(), error: vi.fn() }
  const openLogin = vi.fn()
  const actions = useOfflineAdd({
    api: () => ({ add }) as never,
    notify,
    openLogin,
  })
  return { actions, notify, openLogin }
}

describe('115 离线下载按钮', () => {
  it('未登录：提示并打开设置 · 网盘', async () => {
    const t = setup(
      vi.fn(async () => ({ ok: false, error: '请先登录', setup: 'login' }))
    )
    await t.actions.add(ITEM)
    expect(t.notify.error).toHaveBeenCalledWith('请先登录')
    expect(t.openLogin).toHaveBeenCalled()
    expect(t.actions.isAdded(ITEM.link)).toBe(false)
  })

  it('进行中不重发；成功后标成已添加并说明存到哪', async () => {
    let finish: (value: unknown) => void = () => {}
    const add = vi.fn(() => new Promise(resolve => (finish = resolve)))
    const t = setup(add)
    const first = t.actions.add(ITEM)
    void t.actions.add(ITEM)
    expect(add).toHaveBeenCalledTimes(1)
    expect(t.actions.isAdding(ITEM.link)).toBe(true)
    finish({
      ok: true,
      folder: '新片',
      items: [
        { link: ITEM.link, ok: true, existed: false, hash: '', name: '' },
      ],
    })
    await first
    expect(t.actions.isAdded(ITEM.link)).toBe(true)
    expect(t.notify.success).toHaveBeenCalledWith(
      expect.stringContaining('「新片」')
    )
  })

  it('115 拒绝这条链接或 IPC 抛错时提示，不标成已添加', async () => {
    const t = setup(
      vi.fn(async () => ({
        ok: true,
        folder: '',
        items: [
          {
            link: ITEM.link,
            ok: false,
            existed: false,
            hash: '',
            name: '',
            error: '链接不合法',
          },
        ],
      }))
    )
    await t.actions.add(ITEM)
    expect(t.notify.error).toHaveBeenCalledWith('链接不合法')
    const u = setup(vi.fn(async () => Promise.reject(new Error('断开'))))
    await u.actions.add(ITEM)
    expect(u.notify.error).toHaveBeenCalledWith('离线下载失败：断开')
    expect(u.actions.isAdding(ITEM.link)).toBe(false)
  })
})

describe('离线任务文字', () => {
  const task: OfflineTask = {
    hash: 'a',
    name: 'A',
    size: 1536 * 1024 ** 2,
    percent: 63.7,
    status: 'running',
    addedAt: Date.UTC(2026, 9, 26, 12),
    folder: '',
    imported: false,
  }
  it('状态', () => {
    expect(offlineStatusLabel(task)).toBe('下载中 63%')
    expect(offlineStatusLabel({ ...task, status: 'waiting' })).toBe('等待中')
    expect(offlineStatusLabel({ ...task, status: 'done' })).toBe(
      '已完成 · 等待入库'
    )
    expect(
      offlineStatusLabel({ ...task, status: 'done', imported: true })
    ).toBe('已完成 · 已入库')
    expect(offlineStatusLabel({ ...task, status: 'failed' })).toBe('失败')
  })
  it('说明：大小、文件夹（根目录）、日期', () => {
    expect(offlineMeta(task)).toEqual(['1.5 GB', '存到 根目录', '2026-10-26'])
    expect(offlineMeta({ ...task, size: 0, folder: '新片' })[0]).toBe(
      '存到 新片'
    )
  })
})
