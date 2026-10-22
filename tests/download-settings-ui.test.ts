import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultValues } from '../src/shared/settings/schema'

/**
 * 渲染层：下载目录的显示、选择、恢复默认。window.api.settings 用替身，
 * 主进程广播（onChanged）回来后界面跟着变。
 */
type Change = { key: string; value: unknown }

function fakeBridge(): {
  bridge: Record<string, unknown>
  broadcast: (change: Change) => void
  set: ReturnType<typeof vi.fn>
  chooseDownloadDir: ReturnType<typeof vi.fn>
} {
  const listeners: Array<(change: Change) => void> = []
  const set = vi.fn(async () => {})
  const chooseDownloadDir = vi.fn(async () => '/mnt/picked')
  return {
    bridge: {
      snapshot: () => ({
        values: defaultValues(),
        secrets: { 'scrape.tmdbToken': false },
        legacyMigrated: true,
      }),
      migrateLegacy: () => {
        throw new Error('不应迁移')
      },
      onChanged: (fn: (change: Change) => void) => listeners.push(fn),
      onSecretChanged: () => {},
      set,
      chooseDownloadDir,
    },
    broadcast: change => listeners.forEach(fn => fn(change)),
    set,
    chooseDownloadDir,
  }
}

let fake: ReturnType<typeof fakeBridge>

beforeEach(() => {
  vi.resetModules()
  fake = fakeBridge()
  vi.stubGlobal('window', { api: { settings: fake.bridge } })
})

const render = async (): Promise<string> => {
  const { default: DownloadSettings } =
    await import('../src/renderer/src/features/download/components/DownloadSettings.vue')
  return renderToString(h(DownloadSettings))
}

describe('下载目录设置', () => {
  it('默认：显示默认目录说明，没有「默认」按钮；主进程广播新目录后显示新目录和「默认」', async () => {
    let html = await render()
    expect(html).toContain('下载目录')
    expect(html).toContain('value="默认：「视频」文件夹 / 影盒下载"')
    expect(html).toContain('aria-label="选择下载目录…"')
    expect(html).not.toContain('恢复默认下载目录')

    fake.broadcast({ key: 'download.dir', value: 'D:\\影盒' })
    html = await render()
    expect(html).toContain('value="D:\\影盒"')
    expect(html).toContain('恢复默认下载目录')
  })

  it('选择走 settings.chooseDownloadDir；恢复默认把设置写回空串', async () => {
    const { pickDownloadDir, resetDownloadDir } =
      await import('../src/renderer/src/features/download/download-dir')
    expect(await pickDownloadDir()).toBe('/mnt/picked')
    expect(fake.chooseDownloadDir).toHaveBeenCalledTimes(1)

    fake.broadcast({ key: 'download.dir', value: '/mnt/picked' })
    await resetDownloadDir()
    expect(fake.set).toHaveBeenCalledWith('download.dir', '')
  })

  it('没有桌面端桥接时选择报错', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
    })
    const { pickDownloadDir } =
      await import('../src/renderer/src/features/download/download-dir')
    await expect(pickDownloadDir()).rejects.toThrow('需要桌面端')
  })

  it('「下载」设置分区只在成人模式显示', async () => {
    const { downloadSettingsSection } =
      await import('../src/renderer/src/features/download')
    expect(downloadSettingsSection).toMatchObject({
      id: 'download',
      title: '下载',
      adultOnly: true,
    })
  })
})
