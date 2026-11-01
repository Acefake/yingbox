// test-affected: repo-wide（最后一例读 LibraryGlobalSettings.vue 源码文本，vitest 依赖图看不到）
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_LIBRARY_AUTOMATION,
  type LibraryInfo,
} from '../../src/shared/library/ipc'
import { defaultValues } from '../../src/shared/settings/schema'

/**
 * 渲染层：「自动入库」组里每个文件夹的「存储」（自动 / 本地盘 / 网盘，auto 显示判定结果），
 * 以及「网盘变更通知」组（开关、令牌打码的地址、局域网访问、挂载目录）。
 * window.api.settings / libraryNotify 用替身。
 */
const lib = (patch: Partial<LibraryInfo> = {}): LibraryInfo => ({
  id: 1,
  name: '电影',
  root: 'D:\\CloudDrive\\115\\电影',
  kind: 'movie',
  source: 'tmdb',
  createdAt: 0,
  lastScanAt: null,
  automation: { ...DEFAULT_LIBRARY_AUTOMATION },
  ...patch,
})

describe('存储与通知的文字规则', () => {
  it('storageDescription：指定网盘 / 本地盘，auto 带判定结果，没判定完时说按磁盘判断', async () => {
    const { storageDescription, STORAGE_OPTIONS } =
      await import('../../src/renderer/src/features/library/settings/settings-rules')
    expect(STORAGE_OPTIONS.map(o => o.value)).toEqual([
      'auto',
      'local',
      'cloud',
    ])
    const cloud = { ...DEFAULT_LIBRARY_AUTOMATION, storage: 'cloud' as const }
    expect(storageDescription({ automation: cloud })).toMatch(
      /不定时扫描.*不读视频内容/
    )
    const local = { ...DEFAULT_LIBRARY_AUTOMATION, storage: 'local' as const }
    expect(storageDescription({ automation: local })).toMatch(/监控文件变化/)
    const auto = DEFAULT_LIBRARY_AUTOMATION
    expect(storageDescription({ automation: auto })).toBe(
      '按文件夹所在的磁盘自动判断'
    )
    expect(storageDescription({ automation: auto, cloud: true })).toMatch(
      /^判断为网盘：不定时扫描/
    )
    expect(storageDescription({ automation: auto, cloud: false })).toMatch(
      /^判断为本地盘.*选「网盘」/
    )
  })

  it('maskNotifyUrl：令牌只留末 4 位；notifyAddressText 先报错误', async () => {
    const { maskNotifyUrl, notifyAddressText } =
      await import('../../src/renderer/src/features/library/settings/notify-rules')
    const url = 'http://127.0.0.1:47291/library/notify?token=0123456789abcdef'
    expect(maskNotifyUrl(url)).toBe(
      'http://127.0.0.1:47291/library/notify?token=••••cdef'
    )
    expect(notifyAddressText({ running: true, url, error: null })).toBe(
      maskNotifyUrl(url)
    )
    expect(
      notifyAddressText({ running: false, url: null, error: '端口被占用' })
    ).toBe('端口被占用')
    expect(notifyAddressText({ running: false, url: null, error: null })).toBe(
      '正在启动…'
    )
  })
})

type Change = { key: string; value: unknown }

interface FakeApi {
  api: {
    settings: Record<string, unknown>
    libraryNotify: Record<string, ReturnType<typeof vi.fn>>
  }
  set: ReturnType<typeof vi.fn>
}

function fakeApi(values: Record<string, unknown> = {}): FakeApi {
  const listeners: Array<(change: Change) => void> = []
  const set = vi.fn(async () => {})
  const status = {
    running: true,
    url: 'http://127.0.0.1:47291/library/notify?token=0123456789abcdef',
    error: null,
  }
  return {
    api: {
      settings: {
        snapshot: () => ({
          values: { ...defaultValues(), ...values },
          secrets: { 'scrape.tmdbToken': false },
          legacyMigrated: true,
        }),
        migrateLegacy: () => {
          throw new Error('不应迁移')
        },
        onChanged: (fn: (change: Change) => void) => listeners.push(fn),
        onSecretChanged: () => {},
        set,
      },
      libraryNotify: {
        status: vi.fn(async () => status),
        resetToken: vi.fn(async () => status),
        onChanged: vi.fn(),
        offChanged: vi.fn(),
      },
    },
    set,
  }
}

describe('设置界面', () => {
  beforeEach(() => vi.resetModules())

  it('自动入库组：存储行在最前，三个选项，选中当前值，描述带判定结果', async () => {
    vi.stubGlobal('window', { api: fakeApi().api })
    const { default: Group } =
      await import('../../src/renderer/src/features/library/settings/LibraryAutomationGroup.vue')
    const html = await renderToString(
      h(Group, { libraries: [lib({ cloud: true })], update: async () => {} })
    )
    expect(html.indexOf('存储')).toBeLessThan(html.indexOf('监控文件夹'))
    for (const label of ['自动', '本地盘', '网盘'])
      expect(html).toContain(label)
    expect(html).toContain('判断为网盘')
  })

  it('通知组：关着时只有开关；打开后有打码地址、复制、换令牌、局域网访问、挂载目录', async () => {
    vi.stubGlobal('window', { api: fakeApi().api })
    const { default: Off } =
      await import('../../src/renderer/src/features/library/settings/LibraryNotifyGroup.vue')
    const off = await renderToString(h(Off))
    expect(off).toContain('接收变更通知')
    expect(off).not.toContain('换令牌')
    expect(off).not.toContain('允许局域网访问')

    vi.resetModules()
    const fake = fakeApi({
      'library.notify.enabled': true,
      'library.notify.mountRoot': 'D:\\CloudDrive',
    })
    vi.stubGlobal('window', { api: fake.api })
    const { default: On } =
      await import('../../src/renderer/src/features/library/settings/LibraryNotifyGroup.vue')
    const on = await renderToString(h(On))
    for (const text of [
      '通知地址',
      '复制',
      '换令牌',
      '允许局域网访问',
      '挂载目录',
    ])
      expect(on).toContain(text)
    expect(on).toContain('value="D:\\CloudDrive"')
    expect(fake.api.libraryNotify.status).toHaveBeenCalled()
    expect(fake.api.libraryNotify.onChanged).toHaveBeenCalled()
  })

  it('媒体库设置：桌面端才显示通知组', async () => {
    // 通知组放在媒体库全局设置里，只在桌面端（不走片库服务）且有 libraryNotify 时显示
    const source = (await import('node:fs')).readFileSync(
      'src/renderer/src/features/library/settings/LibraryGlobalSettings.vue',
      'utf8'
    )
    expect(source).toMatch(/<LibraryNotifyGroup v-if="showNotify"/)
    expect(source).toMatch(/const desktop = !usesLibraryServer\(\)/)
    expect(source).toMatch(
      /showNotify = desktop && Boolean\(window\.api\?\.libraryNotify\)/
    )
  })
})
