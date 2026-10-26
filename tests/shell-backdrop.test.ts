/**
 * 窗口键胶囊底色声明：任一页面声明为真即为真，作用域结束自动撤回。
 */
import { describe, expect, it } from 'vitest'
import { type EffectScope, effectScope } from 'vue'

import {
  toolbarOverMedia,
  useShellBackdrop,
} from '../src/renderer/src/composables/use-shell-backdrop'

function claim(scope: EffectScope): ReturnType<typeof useShellBackdrop> {
  const set = scope.run(useShellBackdrop)
  if (!set) throw new Error('作用域已停止')
  return set
}

describe('useShellBackdrop', () => {
  it('跟随声明，作用域结束撤回', () => {
    const scope = effectScope()
    const set = claim(scope)
    set(true)
    expect(toolbarOverMedia.value).toBe(true)
    set(false)
    expect(toolbarOverMedia.value).toBe(false)
    set(true)
    scope.stop()
    expect(toolbarOverMedia.value).toBe(false)
  })

  it('多个页面声明时任一为真即为真', () => {
    const a = effectScope()
    const b = effectScope()
    claim(a)(true)
    claim(b)(false)
    expect(toolbarOverMedia.value).toBe(true)
    a.stop()
    expect(toolbarOverMedia.value).toBe(false)
    b.stop()
  })
})
