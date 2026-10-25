// @vitest-environment jsdom
import {
  type App,
  type Ref,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FOCUS_SCOPE_ATTR,
  createFocusTrapStack,
  shouldReclaim,
  useModalFocus,
} from '../src/renderer/src/composables/use-focus-trap'

/**
 * 模态焦点管理（use-focus-trap）：该不该拉回焦点的判断、陷阱栈，以及 useModalFocus 在真实 DOM 下的
 * 打开移入、Tab 首尾循环、关闭 / 卸载还原、叠层与非模态浮层放行。
 */

const apps: App[] = []

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** 一个模态面板：根 tabindex=-1，里面两个按钮；open 控制 v-show 式的显隐 */
function modal(
  id: string,
  open: Ref<boolean>
): ReturnType<typeof defineComponent> {
  return defineComponent({
    setup() {
      const root = ref<HTMLElement | null>(null)
      const trap = useModalFocus(root, () => open.value)
      return () =>
        h(
          'div',
          {
            id,
            ref: root,
            tabindex: -1,
            role: 'dialog',
            style: open.value ? '' : 'display: none',
            onKeydown: trap,
          },
          [
            h('button', { id: `${id}-a` }, 'a'),
            h('button', { id: `${id}-b` }, 'b'),
          ]
        )
    },
  })
}

/** 挂到 body 上的新宿主里 */
function mount(component: ReturnType<typeof defineComponent>): App {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(component)
  app.mount(host)
  apps.push(app)
  return app
}

/** 页面上一个可聚焦的按钮（模拟打开前的焦点） */
function trigger(id = 'trigger'): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  document.body.appendChild(button)
  return button
}

const byId = (id: string): HTMLElement =>
  document.getElementById(id) as HTMLElement

function tab(target: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('shouldReclaim', () => {
  const panel = document.createElement('div')
  const inside = document.createElement('button')
  panel.appendChild(inside)
  const outside = document.createElement('input')
  const scope = document.createElement('div')
  scope.setAttribute(FOCUS_SCOPE_ATTR, '')
  const inScope = document.createElement('textarea')
  scope.appendChild(inScope)
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  const inDialog = document.createElement('button')
  dialog.appendChild(inDialog)
  const pop = document.createElement('div')
  pop.setAttribute('popover', 'manual')
  const inPop = document.createElement('button')
  pop.appendChild(inPop)

  it('栈顶陷阱把落到面板外的焦点拉回', () => {
    expect(shouldReclaim(outside, panel, true)).toBe(true)
  })

  it('面板内、非栈顶、放行区里的焦点都不拉回', () => {
    expect(shouldReclaim(inside, panel, true)).toBe(false)
    expect(shouldReclaim(outside, panel, false)).toBe(false)
    expect(shouldReclaim(inScope, panel, true)).toBe(false)
    expect(shouldReclaim(inDialog, panel, true)).toBe(false)
    expect(shouldReclaim(inPop, panel, true)).toBe(false)
  })

  it('aria-modal="false" 的非模态面板不再靠 aria-modal 判断：没有作用域标记就拉回', () => {
    const side = document.createElement('section')
    side.setAttribute('aria-modal', 'false')
    const input = document.createElement('input')
    side.appendChild(input)
    expect(shouldReclaim(input, panel, true)).toBe(true)
  })
})

describe('createFocusTrapStack', () => {
  it('最后压入的是栈顶，移出后下面一层回到栈顶', () => {
    const stack = createFocusTrapStack()
    const a = {}
    const b = {}
    stack.push(a)
    const removeB = stack.push(b)
    expect(stack.isTop(b)).toBe(true)
    expect(stack.isTop(a)).toBe(false)
    removeB()
    removeB()
    expect(stack.isTop(a)).toBe(true)
  })
})

describe('useModalFocus', () => {
  it('打开时焦点移到面板根，关闭后还给打开前的元素', async () => {
    const open = ref(false)
    const before = trigger()
    before.focus()
    mount(modal('m', open))
    open.value = true
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(byId('m'))
    open.value = false
    await nextTick()
    expect(document.activeElement).toBe(before)
  })

  it('以打开状态挂载也会移入焦点', async () => {
    trigger().focus()
    mount(modal('m', ref(true)))
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(byId('m'))
  })

  it('Tab 在首尾之间循环', async () => {
    mount(modal('m', ref(true)))
    await nextTick()
    byId('m-b').focus()
    const forward = tab(byId('m-b'))
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(byId('m-a'))
    tab(byId('m-a'), true)
    expect(document.activeElement).toBe(byId('m-b'))
  })

  it('打开状态下卸载也还原焦点', async () => {
    const before = trigger()
    before.focus()
    const app = mount(modal('m', ref(true)))
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(byId('m'))
    app.unmount()
    apps.splice(apps.indexOf(app), 1)
    expect(document.activeElement).toBe(before)
  })

  it('打开前焦点在 body 上时关闭不去 focus body', async () => {
    const open = ref(false)
    mount(modal('m', open))
    ;(document.activeElement as HTMLElement | null)?.blur()
    open.value = true
    await nextTick()
    await nextTick()
    const bodyFocus = vi.spyOn(document.body, 'focus')
    open.value = false
    await nextTick()
    expect(bodyFocus).not.toHaveBeenCalled()
  })

  it('栈顶陷阱把跑到背后页面的焦点拉回', async () => {
    const outside = trigger('outside')
    mount(modal('m', ref(true)))
    await nextTick()
    outside.focus()
    expect(document.activeElement).toBe(byId('m-a'))
  })

  it('叠层：上面的弹窗拥有焦点，下面的不抢；上面关掉后下面恢复拦截', async () => {
    const top = ref(false)
    mount(modal('below', ref(true)))
    mount(modal('above', top))
    top.value = true
    await nextTick()
    await nextTick()
    byId('above-b').focus()
    expect(document.activeElement).toBe(byId('above-b'))
    // 焦点跑到下面那层：上面的陷阱拉回自己
    byId('below-b').focus()
    expect(document.activeElement).toBe(byId('above-a'))
    top.value = false
    await nextTick()
    trigger('outside').focus()
    expect(document.activeElement).toBe(byId('below-a'))
  })

  it('带 data-focus-scope 的非模态浮层（侧栏助手）焦点不被抢', async () => {
    mount(modal('m', ref(true)))
    await nextTick()
    const side = document.createElement('section')
    side.setAttribute(FOCUS_SCOPE_ATTR, '')
    side.setAttribute('aria-modal', 'false')
    const input = document.createElement('input')
    side.appendChild(input)
    document.body.appendChild(side)
    input.focus()
    expect(document.activeElement).toBe(input)
  })
})
