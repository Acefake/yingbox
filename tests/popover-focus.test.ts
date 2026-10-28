// @vitest-environment jsdom
import { type App, createApp, h, nextTick } from 'vue'
import { afterEach, expect, it } from 'vitest'
import UiGlassSelect from '../src/renderer/src/components/ui/UiGlassSelect.vue'
import TargetFolderPill from '../src/renderer/src/features/netdisk/components/TargetFolderPill.vue'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  localStorage.clear()
})

for (const kind of ['select', 'folder']) {
  it(`${kind} 打开后聚焦选项，Esc 关闭回到触发器`, async () => {
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp({
      render: () =>
        kind === 'select'
          ? h(UiGlassSelect, {
              label: '排序',
              modelValue: 'a',
              options: [
                { value: 'a', label: '名称' },
                { value: 'b', label: '时间' },
              ],
            })
          : h(TargetFolderPill, { folder: { cid: '0', name: '根目录' } }),
    })
    app.directive('tooltip', {})
    app.mount(host)
    const trigger = host.querySelector('button')!
    trigger.focus()
    trigger.click()
    await nextTick()
    await nextTick()
    const panel = document.getElementById(
      trigger.getAttribute('aria-controls')!
    )!
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(panel.querySelector('[role="menuitemradio"]')).toBeNull()
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
    await nextTick()
    expect(document.getElementById(panel.id)).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
}
