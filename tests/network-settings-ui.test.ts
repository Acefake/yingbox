// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultValues } from '../src/shared/settings/schema'

const set = vi.fn(async () => {})
const probe = vi.fn(async () => [])
let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

it('配置以草稿编辑，测试不落盘，保存才提交配置', async () => {
  vi.resetModules()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      settings: {
        snapshot: () => ({
          values: defaultValues(),
          secrets: {},
          legacyMigrated: true,
        }),
        onChanged: () => {},
        onSecretChanged: () => {},
        set,
        probeNetwork: probe,
      },
    },
  })
  const { default: Page } =
    await import('../src/renderer/src/features/settings/sections/NetworkSettings.vue')
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(Page)
  app.mount(root)
  unmount = () => app.unmount()
  const button = (text: string): HTMLButtonElement => {
    const found = [...root.querySelectorAll('button')].find(
      node => node.textContent?.trim() === text
    )
    if (!found) throw new Error(`找不到按钮 ${text}`)
    return found
  }
  button('仅官方').click()
  await nextTick()
  expect(set).not.toHaveBeenCalled()
  button('测试连接').click()
  await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce())
  expect(set).not.toHaveBeenCalled()
  button('保存设置').click()
  await vi.waitFor(() =>
    expect(set).toHaveBeenCalledWith(
      'network.optimization',
      expect.objectContaining({ githubMode: 'direct' })
    )
  )
})
