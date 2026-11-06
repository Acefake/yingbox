// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('软件更新提示', () => {
  beforeEach(() => vi.resetModules())

  it('下载好后点更新并重启进入安装中，安装出错时恢复', async () => {
    let notify = (_event: unknown): void => {}
    const install = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      update: {
        onStatus: (cb: typeof notify) => {
          notify = cb
        },
        snapshot: vi
          .fn()
          .mockResolvedValue({ currentVersion: '1.0.0', status: null }),
        install,
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()
    notify({ status: 'downloaded', info: { version: '1.1.0' } })
    await state.runAction()
    expect(install).toHaveBeenCalledTimes(1)
    expect(state.installing.value).toBe(true)
    notify({ status: 'error', error: '启动安装包失败' })
    expect(state.installing.value).toBe(false)
  })

  it('恢复启动检查结果并展示发布说明', async () => {
    const onStatus = vi.fn()
    vi.stubGlobal('api', {
      update: {
        onStatus,
        snapshot: vi.fn().mockResolvedValue({
          currentVersion: '1.0.0',
          status: {
            status: 'available',
            info: {
              version: '1.1.0',
              releaseNotes: '<p>新增搜索</p><p>修复播放</p>',
            },
          },
        }),
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()
    await vi.waitFor(() => expect(state.status.value).toBe('available'))
    expect(state.version.value).toBe('1.1.0')
    expect(state.currentVersion.value).toBe('1.0.0')
    expect(state.notes.value).toContain('新增搜索\n修复播放')
  })

  it('下载失败时展示错误', async () => {
    let notify = (_event: unknown): void => {}
    vi.stubGlobal('api', {
      update: {
        onStatus: (cb: typeof notify) => {
          notify = cb
        },
        snapshot: vi
          .fn()
          .mockResolvedValue({ currentVersion: '1.0.0', status: null }),
        download: vi
          .fn()
          .mockResolvedValue({ success: false, error: '下载失败' }),
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()
    notify({ status: 'available', info: { version: '1.1.0' } })
    await state.runAction()
    expect(state.message.value).toContain('下载失败')
    expect(state.busy.value).toBe(false)
  })

  it('按失败环节给出不同标题和处理建议', async () => {
    let notify = (_event: unknown): void => {}
    vi.stubGlobal('api', {
      update: {
        onStatus: (cb: typeof notify) => {
          notify = cb
        },
        snapshot: vi
          .fn()
          .mockResolvedValue({ currentVersion: '1.0.0', status: null }),
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()

    notify({ status: 'error', error: '连不上 GitHub', phase: 'check' })
    expect(state.title.value).toBe('更新检查失败')
    expect(state.message.value).toContain('连不上 GitHub')
    expect(state.message.value).toContain('发布页')

    notify({ status: 'error', error: '安装包没下完', phase: 'download' })
    expect(state.title.value).toBe('更新下载失败')
    expect(state.message.value).toContain('安装包没下完')
    expect(state.message.value).toContain('重试')

    notify({ status: 'error', error: '启动失败', phase: 'install' })
    expect(state.title.value).toBe('更新安装失败')
    expect(state.message.value).toContain('启动失败')
  })

  it('错误事件不带环节时按检查失败处理', async () => {
    let notify = (_event: unknown): void => {}
    vi.stubGlobal('api', {
      update: {
        onStatus: (cb: typeof notify) => {
          notify = cb
        },
        snapshot: vi
          .fn()
          .mockResolvedValue({ currentVersion: '1.0.0', status: null }),
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()
    notify({ status: 'error', error: '网络错误' })
    expect(state.phase.value).toBe('check')
    expect(state.title.value).toBe('更新检查失败')
  })

  it('重新加载时恢复已下载版本的更新说明', async () => {
    vi.stubGlobal('api', {
      update: {
        onStatus: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({
          currentVersion: '1.0.0',
          info: { version: '1.1.0', releaseNotes: '更新说明' },
          status: { status: 'downloaded', info: { version: '1.1.0' } },
        }),
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()
    await vi.waitFor(() => expect(state.status.value).toBe('downloaded'))
    expect(state.notes.value).toBe('更新说明')
    expect(state.action.value).toBe('更新并重启')
  })

  it('实时下载进度先于快照返回时仍恢复更新说明', async () => {
    let notify = (_event: unknown): void => {}
    let resolveSnapshot!: (value: unknown) => void
    vi.stubGlobal('api', {
      update: {
        onStatus: (cb: typeof notify) => {
          notify = cb
        },
        snapshot: () =>
          new Promise(resolve => {
            resolveSnapshot = resolve
          }),
      },
    })
    const { useUpdateStatus } =
      await import('../src/renderer/src/features/settings/use-update-status')
    const state = useUpdateStatus()
    notify({ status: 'downloading', progress: { percent: 50 } })
    resolveSnapshot({
      currentVersion: '1.0.0',
      info: { version: '1.1.0', releaseNotes: '更新说明' },
      status: { status: 'available', info: { version: '1.1.0' } },
    })
    await vi.waitFor(() => expect(state.notes.value).toBe('更新说明'))
    expect(state.status.value).toBe('downloading')
    expect(state.version.value).toBe('1.1.0')
  })
})
