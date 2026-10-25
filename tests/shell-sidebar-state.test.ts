import { describe, expect, it } from 'vitest'

import {
  SIDEBAR_COLLAPSED_KEY,
  isSidebarShortcut,
  readSidebarCollapsed,
} from '../src/renderer/src/features/shell/composables/sidebar-state'

const key = (
  k: string,
  extra: Partial<Parameters<typeof isSidebarShortcut>[0]> = {}
): Parameters<typeof isSidebarShortcut>[0] => ({
  key: k,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
})

describe('侧栏收起状态', () => {
  it('Ctrl+B / Cmd+B 切换，带 Shift / Alt、输入法组字、弹窗里不算', () => {
    expect(isSidebarShortcut(key('b'))).toBe(true)
    expect(isSidebarShortcut(key('B'))).toBe(true)
    expect(isSidebarShortcut(key('b', { ctrlKey: false, metaKey: true }))).toBe(
      true
    )
    expect(isSidebarShortcut(key('b', { ctrlKey: false }))).toBe(false)
    expect(isSidebarShortcut(key('b', { shiftKey: true }))).toBe(false)
    expect(isSidebarShortcut(key('b', { altKey: true }))).toBe(false)
    expect(isSidebarShortcut(key('b', { isComposing: true }))).toBe(false)
    expect(isSidebarShortcut(key('f'))).toBe(false)
    const inDialog = {
      closest: (s: string) => (s === '[role="dialog"]' ? {} : null),
    }
    expect(
      isSidebarShortcut(
        key('b', { target: inDialog as unknown as EventTarget })
      )
    ).toBe(false)
  })

  it('读出上次的状态：只有 "1" 是收起，存储出错时展开', () => {
    const store = (v: string | null) => ({
      getItem: (k: string) => (k === SIDEBAR_COLLAPSED_KEY ? v : null),
    })
    expect(readSidebarCollapsed(store('1'))).toBe(true)
    expect(readSidebarCollapsed(store('0'))).toBe(false)
    expect(readSidebarCollapsed(store(null))).toBe(false)
    expect(
      readSidebarCollapsed({
        getItem: () => {
          throw new Error('denied')
        },
      })
    ).toBe(false)
  })
})
