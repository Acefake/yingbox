/**
 * 外壳底色声明：侧栏与窗口键胶囊分开算，作用域结束自动撤回。
 */
import { describe, expect, it } from 'vitest'
import { type EffectScope, effectScope } from 'vue'

import {
  sidebarOverMedia,
  toolbarOverMedia,
  useShellBackdrop,
} from '../src/renderer/src/composables/use-shell-backdrop'

function claim(scope: EffectScope): ReturnType<typeof useShellBackdrop> {
  const set = scope.run(useShellBackdrop)
  if (!set) throw new Error('作用域已停止')
  return set
}

describe('useShellBackdrop', () => {
  it('侧栏与胶囊各自跟随声明', () => {
    const scope = effectScope()
    const set = claim(scope)
    set({ sidebar: false, toolbar: true })
    expect(sidebarOverMedia.value).toBe(false)
    expect(toolbarOverMedia.value).toBe(true)
    set({ sidebar: true, toolbar: true })
    expect(sidebarOverMedia.value).toBe(true)
    scope.stop()
    expect(sidebarOverMedia.value).toBe(false)
    expect(toolbarOverMedia.value).toBe(false)
  })

  it('多个页面声明时任一为真即为真', () => {
    const a = effectScope()
    const b = effectScope()
    const setA = claim(a)
    const setB = claim(b)
    setA({ sidebar: true, toolbar: false })
    setB({ sidebar: false, toolbar: false })
    expect(sidebarOverMedia.value).toBe(true)
    a.stop()
    expect(sidebarOverMedia.value).toBe(false)
    b.stop()
  })
})
