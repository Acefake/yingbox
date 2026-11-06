// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 测试里就地拼宿主页面 */
import { expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import UpdateChip from '../src/renderer/src/features/settings/UpdateChip.vue'
import UpdateSettings from '../src/renderer/src/features/settings/sections/UpdateSettings.vue'

const state = {
  status: ref('downloaded'),
  currentVersion: ref('1.0.6'),
  version: ref('1.0.7'),
  installing: ref(false),
  busy: ref(false),
  notes: ref(''),
  phase: ref('check'),
  title: ref('更新已下载'),
  message: ref('可以重启安装'),
  action: ref('更新并重启'),
  runAction: vi.fn(() => {
    state.installing.value = true
  }),
}

vi.mock('../src/renderer/src/features/settings/use-update-status', () => ({
  useUpdateStatus: () => state,
}))
vi.mock('../src/renderer/src/features/settings/use-setting', () => ({
  useSetting: () => ref(true),
}))

it('设置显示已安装版本，重启反馈留在更新条且不会重复启动安装', async () => {
  vi.stubGlobal('api', { update: {} })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () => h('div', [h(UpdateChip), h(UpdateSettings)]),
  })
  try {
    app.mount(host)
    expect(host.textContent).toContain('影盒 1.0.6')
    host.querySelector<HTMLButtonElement>('.update-chip button')!.click()
    await nextTick()
    expect(host.querySelector('.update-chip')?.textContent).toContain(
      '正在重启'
    )
    expect(host.querySelector('.update-chip button')).toBeNull()
    host.querySelector<HTMLButtonElement>('button')!.click()
    expect(state.runAction).toHaveBeenCalledTimes(1)
  } finally {
    app.unmount()
    host.remove()
    vi.unstubAllGlobals()
  }
})

it('更新失败时更新条保留提示并给手动下载入口', async () => {
  const openExternal = vi.fn(async () => ({ success: true }))
  vi.stubGlobal('api', { update: {}, shell: { openExternal } })
  const host = document.createElement('div')
  document.body.append(host)
  state.installing.value = false
  state.status.value = 'error'
  state.phase.value = 'download'
  state.title.value = '更新下载失败'
  const app = createApp({ render: () => h(UpdateChip) })
  try {
    app.mount(host)
    expect(host.querySelector('.update-chip')).not.toBeNull()
    expect(host.textContent).toContain('更新下载失败')
    const button = host.querySelector<HTMLButtonElement>('.update-chip button')
    expect(button?.textContent).toContain('打开发布页')
    button!.click()
    await nextTick()
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/Acefake/yingbox/releases/latest'
    )
  } finally {
    app.unmount()
    host.remove()
    vi.unstubAllGlobals()
    state.status.value = 'downloaded'
    state.phase.value = 'check'
    state.title.value = '更新已下载'
  }
})
