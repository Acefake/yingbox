// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import AppearanceSettings from '../src/renderer/src/features/settings/sections/AppearanceSettings.vue'
import { BRAND_OPTIONS } from '../src/renderer/src/components/ui/brand'
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
  const select = host.querySelector<HTMLButtonElement>(
    'button[aria-label^="品牌配色"]'
  )!
  expect(select.textContent).toContain('紫水晶')
  for (const color of [
    'purple',
    'blue',
    'green',
    'gold',
    'white',
    'graphite',
  ]) {
    select.click()
    await nextTick()
    const options = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '.ui-glass-select-option'
      ),
    ]
    expect(options).toHaveLength(6)
    const label = BRAND_OPTIONS.find(option => option.value === color)!.label
    options.find(option => option.textContent?.trim() === label)!.click()
    await nextTick()
    expect(getSetting('ui.brandColor')).toBe(color)
    expect(
      host.querySelector('.brand-picker img')?.getAttribute('src')
    ).toContain(`icon-${color}.png`)
  }
})
