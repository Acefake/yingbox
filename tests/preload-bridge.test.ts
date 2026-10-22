import { beforeAll, describe, expect, it, vi } from 'vitest'

const exposed: Record<
  string,
  Record<string, (...args: unknown[]) => unknown>
> = {}
const invoke = vi.fn((..._args: unknown[]) => Promise.resolve('ok'))
const sendSync = vi.fn((..._args: unknown[]): unknown => ({
  ok: true,
  value: 'sync-ok',
}))
const listeners = new Map<
  string,
  Array<(event: unknown, payload: unknown) => void>
>()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: typeof exposed) => {
      if (key === 'api') Object.assign(exposed, value)
    },
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    sendSync: (...args: unknown[]) => sendSync(...args),
    on: (
      channel: string,
      listener: (event: unknown, payload: unknown) => void
    ) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    },
    removeAllListeners: (channel: string) => listeners.delete(channel),
  },
}))

/**
 * 重构前手写 preload 暴露的方法（src/preload/index.d.ts @ ac92d77），
 * 减去 opt/a 逐个 grep 确认没有调用方而删掉的：file / http / path / config 四个域、
 * dialog.saveFile、app.getUserDataPath / getVersion、lada.otherJob / adoptPartial / clearCache /
 * cacheSize / notice 事件、mpv.playlistNext / playlistPrev / playlistPlay / getStatus。
 */
const LEGACY_API: Record<string, string[]> = {
  dialog: ['openDirectory', 'openFile'],
  app: ['networkIps'],
  update: ['check', 'download', 'install', 'onStatus', 'offStatus'],
  shell: ['openPath'],
  win: ['minimize', 'maximize', 'close', 'isMaximized'],
  player: ['open', 'close', 'getPending', 'onLoad', 'offLoad'],
  subtitle: ['find', 'read', 'searchOnline', 'downloadOnline'],
  lada: [
    'paths',
    'setPaths',
    'start',
    'cancel',
    'status',
    'playablePath',
    'onProgress',
    'offProgress',
    'onFinished',
    'offFinished',
    'startLive',
    'stopLive',
    'liveStatus',
    'onLive',
    'offLive',
    'resumeInfo',
    'resume',
    'startRange',
    'onRangeReady',
    'offRangeReady',
  ],
  mpv: [
    'open',
    'pause',
    'seek',
    'volume',
    'mute',
    'speed',
    'setVsr',
    'setSubTrack',
    'setAudioTrack',
    'addSubFile',
    'quit',
    'onStatus',
    'offStatus',
    'onError',
    'offError',
  ],
}

/** 影视项目维护的域：自带 bridge，不走契约，preload 只负责挂上去。 */
const EXTERNAL_API: Record<string, string[]> = {
  library: [
    'listLibraries',
    'addLibrary',
    'removeLibrary',
    'updateLibrary',
    'scan',
    'query',
    'getItem',
    'identify',
    'getMatchCandidates',
    'getPreview',
    'applyMatch',
    'lockMatch',
    'unlockMatch',
    'refreshMetadata',
    'getProviderStatus',
    'writer',
    'jav',
    'actors',
    'subscribe',
  ],
}

/** 重构后新增的域（旧域保持原样，新增只能在这里登记） */
const ADDED_API: Record<string, string[]> = {
  settings: [
    'snapshot',
    'migrateLegacy',
    'set',
    'setSecret',
    'chooseDownloadDir',
    'onChanged',
    'offChanged',
    'onSecretChanged',
    'offSecretChanged',
  ],
  online: [
    'sites',
    'vod',
    'resetBlocks',
    'getJson',
    'tmdb',
    'doubanTrailer',
    'resolvePage',
  ],
  av: ['list', 'resolve'],
  download: ['list', 'add', 'remove', 'retry', 'onChanged', 'offChanged'],
}

beforeAll(async () => {
  await import('../src/preload/index')
})

describe('通用 preload', () => {
  it('重构前的 window.api 域与方法一个不少、一个不多；新增域只有 settings', () => {
    const actual = Object.fromEntries(
      Object.entries(exposed).map(([domain, api]) => [
        domain,
        Object.keys(api).sort(),
      ])
    )
    const expected = Object.fromEntries(
      Object.entries({ ...LEGACY_API, ...ADDED_API, ...EXTERNAL_API }).map(
        ([domain, keys]) => [domain, [...keys].sort()]
      )
    )
    expect(actual).toEqual(expected)
  })

  it('调用按位置参数转发到「域名:方法名」通道', async () => {
    await exposed.lada.startRange('a', 1, 2)
    expect(invoke).toHaveBeenLastCalledWith('lada:startRange', 'a', 1, 2)
    await exposed.online.tmdb('/movie/1', { language: 'zh-CN' })
    expect(invoke).toHaveBeenLastCalledWith('online:tmdb', '/movie/1', {
      language: 'zh-CN',
    })
  })

  it('同步调用走 sendSync 直接返回值；主进程报错时在渲染层抛出', () => {
    expect(exposed.settings.snapshot()).toBe('sync-ok')
    expect(sendSync).toHaveBeenLastCalledWith('settings:snapshot')
    sendSync.mockReturnValueOnce({ ok: false, error: '设置 x 的值不合法' })
    expect(() => exposed.settings.migrateLegacy({})).toThrow(
      '设置 x 的值不合法'
    )
    expect(sendSync).toHaveBeenLastCalledWith('settings:migrateLegacy', {})
  })

  it('on<事件> 订阅后收到载荷，off<事件> 退订', () => {
    const received: unknown[] = []
    exposed.lada.onRangeReady((info: unknown) => received.push(info))
    for (const listener of listeners.get('lada:rangeReady') ?? [])
      listener({}, { title: 't' })
    expect(received).toEqual([{ title: 't' }])

    exposed.lada.offRangeReady()
    expect(listeners.has('lada:rangeReady')).toBe(false)
  })
})
