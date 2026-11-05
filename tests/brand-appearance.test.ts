// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import AppearanceSettings from '../src/renderer/src/features/settings/sections/AppearanceSettings.vue'
import {
  getSetting,
  setSetting,
} from '../src/renderer/src/features/settings/use-setting'

vi.mock('../src/renderer/src/features/settings/server-settings', () => ({
  pullServerSettings: async () => {},
  syncsToServer: () => false,
}))

let app: App | undefined
let host: HTMLDivElement | undefined
afterEach(() => {
  app?.unmount()
  host?.remove()
})

it('外观设置能切换六种实际图标并保存选择', async () => {
  await setSetting('ui.brandColor', 'purple')
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(AppearanceSettings)
  app.mount(host)
  const select = host.querySelector<HTMLSelectElement>(
    'select[aria-label="品牌配色"]'
  )!
  expect(select.value).toBe('purple')
  expect(select.options).toHaveLength(6)
  for (const color of [
    'purple',
    'blue',
    'green',
    'gold',
    'white',
    'graphite',
  ]) {
    select.value = color
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(getSetting('ui.brandColor')).toBe(color)
    expect(
      host.querySelector('.brand-picker img')?.getAttribute('src')
    ).toContain(`icon-${color}.png`)
  }
})
