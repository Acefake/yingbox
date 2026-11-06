// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import UpdateCompanion from '../src/renderer/src/features/settings/UpdateCompanion.vue'

it('独立窗口复用动态 Logo 和品牌配色，安装等待不显示虚假的百分比', async () => {
  let notify = (_state: { color: string; error?: string }): void => {}
  const unsubscribe = vi.fn()
  const close = vi.fn()
  vi.stubGlobal('updateCompanion', {
    ready: vi.fn(),
    close,
    onState: (callback: typeof notify) => {
      notify = callback
      return unsubscribe
    },
  })
  const host = document.createElement('div')
  const app = createApp(UpdateCompanion)
  try {
    app.mount(host)
    expect(
      host.querySelector('.yb-glass .ui-brand-logo .brand-sheen')
    ).not.toBeNull()
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    notify({ color: 'blue' })
    await nextTick()
    expect(
      host.querySelector('.ui-brand-logo img')?.getAttribute('src')
    ).toContain('icon-blue.png')
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    notify({ color: 'blue', error: '安装程序退出，错误码 1' })
    await nextTick()
    expect(host.textContent).toContain('错误码 1')
    host.querySelector<HTMLButtonElement>('button')!.click()
    expect(close).toHaveBeenCalledOnce()
  } finally {
    app.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  }
})
