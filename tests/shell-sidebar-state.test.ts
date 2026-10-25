import { describe, expect, it } from 'vitest'

import { settingsSchema } from '../src/shared/settings/schema'
import { isSidebarShortcut } from '../src/renderer/src/features/shell/composables/sidebar-state'

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

  it('收起状态存在设置 ui.sidebarCollapsed 里，默认展开', () => {
    expect(settingsSchema['ui.sidebarCollapsed'].default).toBe(false)
  })
})
