import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { type DirectiveBinding, effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import {
  createEscapeStack,
  guardDialogEscape,
  handleEscape,
  useEscapeLayer,
} from '@/composables/use-escape-layer'
import { isEnterTarget, vEnter } from '@/directives/enter'
import { isComposing, isDismissKey, isSubmitKey } from '@/utils/keyboard'

/** 造一个 keydown 事件（Node 自带 Event，没有 KeyboardEvent，按键字段直接挂上去） */
function keydown(
  key: string,
  { composing = false, keyCode = key === 'Enter' ? 13 : 27 } = {}
): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true })
  Object.assign(event, { key, isComposing: composing, keyCode })
  return event as KeyboardEvent
}

describe('输入法组字判断', () => {
  it('isComposing 或 keyCode 229 都算组字', () => {
    expect(isComposing(keydown('Enter'))).toBe(false)
    expect(isComposing(keydown('Enter', { composing: true }))).toBe(true)
    expect(isComposing(keydown('Enter', { keyCode: 229 }))).toBe(true)
  })

  it('组字中的回车不是提交，组字中的 Esc 不是关闭', () => {
    expect(isSubmitKey(keydown('Enter'))).toBe(true)
    expect(isSubmitKey(keydown('Enter', { composing: true }))).toBe(false)
    expect(isSubmitKey(keydown('Enter', { keyCode: 229 }))).toBe(false)
    expect(isSubmitKey(keydown('a', { keyCode: 65 }))).toBe(false)
    expect(isDismissKey(keydown('Escape'))).toBe(true)
    expect(isDismissKey(keydown('Escape', { composing: true }))).toBe(false)
    expect(isDismissKey(keydown('Escape', { keyCode: 229 }))).toBe(false)
    expect(isDismissKey(keydown('Enter'))).toBe(false)
  })
})

describe('v-enter 指令', () => {
  type Handler = (event: KeyboardEvent) => void
  const binding = (value: Handler): DirectiveBinding<Handler> =>
    ({ value }) as DirectiveBinding<Handler>
  const vnode = null as unknown as Parameters<
    NonNullable<typeof vEnter.mounted>
  >[2]

  function mount(handler: Handler): HTMLElement {
    const el = new EventTarget() as unknown as HTMLElement
    vEnter.mounted!(el, binding(handler), vnode, null)
    return el
  }

  it('回车触发并阻止默认行为；组字中的回车、其他键不触发', () => {
    const handler = vi.fn()
    const el = mount(handler)
    const enter = keydown('Enter')
    el.dispatchEvent(enter)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBe(enter)
    expect(enter.defaultPrevented).toBe(true)

    const composing = keydown('Enter', { composing: true })
    el.dispatchEvent(composing)
    el.dispatchEvent(keydown('Enter', { keyCode: 229 }))
    el.dispatchEvent(keydown('Escape'))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(composing.defaultPrevented).toBe(false)
  })

  it('只认绑定元素本身和里面的文字输入框；清空按钮等别的控件上的回车不算提交', () => {
    const el = new EventTarget()
    expect(isEnterTarget(el, el)).toBe(true)
    expect(isEnterTarget(el, { tagName: 'INPUT' } as never)).toBe(true)
    expect(isEnterTarget(el, { tagName: 'TEXTAREA' } as never)).toBe(true)
    expect(isEnterTarget(el, { tagName: 'BUTTON' } as never)).toBe(false)
    expect(isEnterTarget(el, null)).toBe(false)
  })

  it('更新后调用新的处理函数，卸载后不再触发', () => {
    const first = vi.fn()
    const second = vi.fn()
    const el = mount(first)
    vEnter.updated!(el, binding(second), vnode, vnode)
    el.dispatchEvent(keydown('Enter'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    vEnter.beforeUnmount!(el, binding(second), vnode, null)
    el.dispatchEvent(keydown('Enter'))
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('Esc 按层关闭', () => {
  it('只关最后打开的一层，关掉后下一次 Esc 轮到下面那层', () => {
    const stack = createEscapeStack()
    const drawer = vi.fn()
    const settings = vi.fn()
    stack.push(drawer)
    const removeSettings = stack.push(settings)
    const first = keydown('Escape')
    expect(stack.handle(first)).toBe(true)
    expect(settings).toHaveBeenCalledTimes(1)
    expect(drawer).not.toHaveBeenCalled()
    expect(first.defaultPrevented).toBe(true)
    removeSettings()
    stack.handle(keydown('Escape'))
    expect(drawer).toHaveBeenCalledTimes(1)
    expect(settings).toHaveBeenCalledTimes(1)
  })

  it('组字中的 Esc、已被里层处理过的 Esc、别的键：一层都不关', () => {
    const stack = createEscapeStack()
    const close = vi.fn()
    stack.push(close)
    expect(stack.handle(keydown('Escape', { composing: true }))).toBe(false)
    expect(stack.handle(keydown('Escape', { keyCode: 229 }))).toBe(false)
    const handled = keydown('Escape')
    handled.preventDefault()
    expect(stack.handle(handled)).toBe(false)
    expect(stack.handle(keydown('Enter'))).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('没有打开的层时不拦 Esc', () => {
    const event = keydown('Escape')
    expect(createEscapeStack().handle(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('useEscapeLayer：打开时入栈，关闭 / 作用域销毁时出栈，重新打开排到最上面', () => {
    const drawerOpen = ref(false)
    const settingsOpen = ref(false)
    const closeDrawer = vi.fn(() => (drawerOpen.value = false))
    const closeSettings = vi.fn(() => (settingsOpen.value = false))
    const drawerScope = effectScope()
    const settingsScope = effectScope()
    drawerScope.run(() => useEscapeLayer(() => drawerOpen.value, closeDrawer))
    settingsScope.run(() =>
      useEscapeLayer(() => settingsOpen.value, closeSettings)
    )

    expect(handleEscape(keydown('Escape'))).toBe(false)
    settingsOpen.value = true
    drawerOpen.value = true
    // 抽屉后打开，在最上面
    expect(handleEscape(keydown('Escape'))).toBe(true)
    expect(closeDrawer).toHaveBeenCalledTimes(1)
    expect(closeSettings).not.toHaveBeenCalled()
    // 抽屉关了，下一次轮到设置
    handleEscape(keydown('Escape'))
    expect(closeSettings).toHaveBeenCalledTimes(1)

    // 设置先开、抽屉后开；再把设置关了重开 → 设置排到最上面
    settingsOpen.value = true
    drawerOpen.value = true
    settingsOpen.value = false
    settingsOpen.value = true
    handleEscape(keydown('Escape'))
    expect(closeSettings).toHaveBeenCalledTimes(2)
    expect(closeDrawer).toHaveBeenCalledTimes(1)

    // 作用域销毁（组件卸载）时出栈
    drawerScope.stop()
    expect(handleEscape(keydown('Escape'))).toBe(false)
    settingsScope.stop()
  })

  it('原生 dialog：Esc 不再冒泡到外层；组字中的 Esc 连对话框也不关', () => {
    const plain = keydown('Escape')
    const stopPlain = vi.spyOn(plain, 'stopPropagation')
    guardDialogEscape(plain)
    expect(stopPlain).toHaveBeenCalled()
    expect(plain.defaultPrevented).toBe(false)

    const composing = keydown('Escape', { composing: true })
    const stopComposing = vi.spyOn(composing, 'stopPropagation')
    guardDialogEscape(composing)
    expect(composing.defaultPrevented).toBe(true)
    expect(stopComposing).toHaveBeenCalled()

    const enter = keydown('Enter')
    const stopEnter = vi.spyOn(enter, 'stopPropagation')
    guardDialogEscape(enter)
    expect(stopEnter).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(false)
  })
})

describe('接线：回车 / Esc 都经过输入法判断', () => {
  const root = 'src/renderer/src'
  const list = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return list(full)
      return /\.(vue|ts)$/.test(entry.name) ? [full] : []
    })
  const sources = list(root).map(file => ({
    file: relative(root, file),
    text: readFileSync(file, 'utf8'),
  }))
  const read = (file: string): string => readFileSync(join(root, file), 'utf8')

  it('文字输入框不再直接写 @keydown.enter / @keyup.enter', () => {
    const offenders = sources
      .filter(({ text }) =>
        /<UiInput\b[^>]*@key(down|up)\.enter/s.test(
          text.replace(/<\/?template[^>]*>/g, '')
        )
      )
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('点名的回车调用方都迁到 v-enter', () => {
    for (const file of [
      'features/online/components/SearchTab.vue',
      'features/online/components/AddSourceDialog.vue',
      'features/shell/components/AppToolbar.vue',
      'features/player/components/SubtitleSearchPanel.vue',
    ]) {
      const text = read(file)
      expect(text, file).toMatch(/\bv-enter="/)
      expect(text, file).not.toMatch(/@keydown\.enter(\.prevent)?="/)
    }
  })

  it("Esc 只经 isDismissKey 判断：别处不再比较 'Escape'、不写 @keydown.esc", () => {
    const offenders = sources
      .filter(({ file }) => file !== join('utils', 'keyboard.ts'))
      .filter(
        ({ text }) =>
          /['"]Escape['"]/.test(text) || /@key(down|up)\.esc\b/.test(text)
      )
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('浮层都登记到 Esc 层栈，不再各自监听 window', () => {
    for (const file of [
      'features/settings/SettingsPanel.vue',
      'features/shell/components/BackgroundTasksPanel.vue',
      'features/shell/AppLayout.vue',
      'features/library/shared/LibrarySheet.vue',
      'features/library/detail/WebPlayer.vue',
    ]) {
      expect(read(file), file).toMatch(/useEscapeLayer\(/)
    }
    expect(read('components/ui/UiConfirmDialog.vue')).toMatch(
      /@keydown="guardDialogEscape"/
    )
    expect(read('directives/context-menu.ts')).toMatch(/isDismissKey\(/)
  })
})
