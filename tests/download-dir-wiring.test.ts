import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FromEngine, ToEngine } from '../src/engine/protocol'

/**
 * 主进程接线：settings.chooseDownloadDir 经 IPC 弹对话框并保存；启动时并入旧 config.json；
 * 后台引擎经宿主方法 downloadDir 读到的是当前设置（改了立即生效）。
 */
const env = vi.hoisted(() => ({
  userData: '',
  videos: '/home/s/Videos',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as Array<[string, unknown]>,
  pick: { canceled: true, filePaths: [] as string[] },
  dialogCalls: [] as unknown[][],
  owner: { id: 'main-window' },
  engine: undefined as
    | undefined
    | { toHost: (m: FromEngine) => void; posted: ToEngine[] },
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? env.userData : env.videos,
    on: () => {},
  },
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => unknown
    ) => env.handlers.set(channel, fn),
    on: (
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => unknown
    ) => env.handlers.set(channel, fn),
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) =>
            env.sent.push([channel, payload]),
        },
      },
    ],
    fromWebContents: () => env.owner,
  },
  dialog: {
    showOpenDialog: async (...args: unknown[]) => {
      env.dialogCalls.push(args)
      return env.pick
    },
  },
  safeStorage: { isEncryptionAvailable: () => false },
  utilityProcess: {
    fork: () => {
      const listeners: Array<(m: FromEngine) => void> = []
      const posted: ToEngine[] = []
      env.engine = { toHost: m => listeners.forEach(l => l(m)), posted }
      return {
        postMessage: (m: ToEngine) => posted.push(m),
        on: (event: string, l: (m: FromEngine) => void) => {
          if (event === 'message') listeners.push(l)
        },
        kill: () => true,
      }
    },
  },
}))
vi.mock('../src/main/browser-fetch', () => ({
  browserFetch: async () => '',
  resetBrowserFetch: () => {},
}))

const invoke = (channel: string, ...args: unknown[]): unknown => {
  const fn = env.handlers.get(channel)
  if (!fn) throw new Error(`没有注册 ${channel}`)
  return fn({ sender: {} }, ...args)
}

/** 让引擎向宿主要一次下载目录，返回宿主的回复 */
async function engineAsksDownloadDir(): Promise<unknown> {
  const engine = env.engine!
  engine.toHost({ kind: 'host', id: 99, method: 'downloadDir', args: [] })
  await vi.waitFor(() =>
    expect(engine.posted.some(m => m.kind === 'hostResult')).toBe(true)
  )
  const reply = engine.posted.find(m => m.kind === 'hostResult')
  engine.posted.length = 0
  return reply
}

beforeEach(() => {
  vi.resetModules()
  env.userData = mkdtempSync(join(tmpdir(), 'yingbox-wiring-'))
  env.handlers.clear()
  env.sent = []
  env.dialogCalls = []
  env.pick = { canceled: true, filePaths: [] }
  env.engine = undefined
})

async function boot(): Promise<void> {
  const { initSettings } = await import('../src/main/settings')
  await initSettings()
}

describe('settings.chooseDownloadDir（IPC）', () => {
  it('对话框挂在发起窗口上、停在当前目录、可新建文件夹；选中后保存并广播', async () => {
    await boot()
    const target = join(env.userData, 'dl')
    mkdirSync(target)
    env.pick = { canceled: false, filePaths: [target] }

    expect(await invoke('settings:chooseDownloadDir')).toBe(target)
    const [owner, options] = env.dialogCalls[0] as [
      unknown,
      { defaultPath: string; properties: string[] },
    ]
    expect(owner).toBe(env.owner)
    expect(options.defaultPath).toBe(join(env.videos, '影盒下载'))
    expect(options.properties).toEqual(['openDirectory', 'createDirectory'])
    expect(env.sent).toContainEqual([
      'settings:changed',
      { key: 'download.dir', value: target },
    ])
    const { settingsStore } = await import('../src/main/settings')
    expect(settingsStore().get('download.dir')).toBe(target)
  })

  it('取消返回 null，不广播（即使对话框带回了路径）', async () => {
    await boot()
    env.pick = { canceled: true, filePaths: [env.userData] }
    expect(await invoke('settings:chooseDownloadDir')).toBeNull()
    expect(env.sent).toEqual([])
  })

  it('启动时并入旧 config.json 的 downloadPath 并删除该文件', async () => {
    const legacy = join(env.userData, 'config.json')
    writeFileSync(legacy, JSON.stringify({ downloadPath: '/mnt/legacy' }))
    await boot()
    const { settingsStore } = await import('../src/main/settings')
    expect(settingsStore().get('download.dir')).toBe('/mnt/legacy')
    expect(existsSync(legacy)).toBe(false)
  })
})

describe('引擎读下载目录（宿主方法 downloadDir）', () => {
  it('未设置时是「视频/影盒下载」；改了设置下一次下载立即用新目录', async () => {
    await boot()
    const { registerEngine } = await import('../src/main/engine')
    const { settingsStore } = await import('../src/main/settings')
    const host = registerEngine()
    void host.invoke('download:list', []).catch(() => {})

    expect(await engineAsksDownloadDir()).toMatchObject({
      ok: true,
      value: join(env.videos, '影盒下载'),
    })
    settingsStore().set('download.dir', '/mnt/nas/av')
    expect(await engineAsksDownloadDir()).toMatchObject({
      ok: true,
      value: '/mnt/nas/av',
    })
  })
})
