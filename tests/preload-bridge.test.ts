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
 * cacheSize / notice 事件、mpv.playlistNext / playlistPrev / playlistPlay / getStatus；
 * 加上之后新增的 mpv.setCompact（缩小置顶）；player 域随内置播放器改回主窗口内播放（#98）整域删除。
 */
const LEGACY_API: Record<string, string[]> = {
  dialog: ['openDirectory', 'openFile'],
  app: ['networkIps'],
  update: ['check', 'download', 'install', 'onStatus', 'offStatus'],
  shell: ['openPath'],
  win: ['minimize', 'maximize', 'close', 'isMaximized'],
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
    'setCompact',
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
    'facets',
    'visual',
    'calendar',
    'progress',
    'merge',
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
    'doubanBrowse',
    'doubanChart',
    'doubanPhotos',
    'resolvePage',
    'probeStream',
  ],
  av: ['list', 'resolve'],
  danmaku: ['match', 'search', 'comments'],
  download: ['list', 'add', 'remove', 'retry', 'onChanged', 'offChanged'],
  introDetect: ['status', 'detect', 'cancel', 'onProgress', 'offProgress'],
  libraryNotify: ['status', 'resetToken', 'onChanged', 'offChanged'],
  notifications: ['test'],
  media: [
    'focus',
    'saveFocus',
    'seekThumbnails',
    'onSeekReady',
    'offSeekReady',
  ],
  capture: ['savePng', 'frame', 'gifAvailable', 'gif', 'reveal'],
  webdav: ['list', 'save', 'remove', 'test', 'listDirs'],
  mpv: [
    ...LEGACY_API['mpv']!,
    'setAnime4k',
    'showText',
    'probe',
    'install',
    'onInstalling',
    'offInstalling',
  ],
  nowPlaying: ['report', 'onCommand', 'offCommand'],
  sectionLock: [
    'status',
    'verify',
    'setPassword',
    'clearPassword',
    'setConfig',
    'promptSystem',
  ],
  iptv: [
    'fetchPlaylist',
    'probeStream',
    'pickPlaylistFile',
    'readPlaylistFile',
    'loadEpg',
    'epgProgrammes',
  ],
  ai: [
    'chat',
    'chatJson',
    'cancel',
    'testConnection',
    'usage',
    'onDelta',
    'offDelta',
    'onUsageChanged',
    'offUsageChanged',
  ],
  aiSubtitles: ['start', 'cancel', 'list', 'find', 'onChanged', 'offChanged'],
  recap: ['probe', 'prepare', 'cancel', 'save'],
  autograb: [
    'overview',
    'setEnabled',
    'setSeries',
    'setPrefs',
    'grab',
    'revert',
    'skip',
    'retry',
    'runNow',
    'resume',
    'onChanged',
    'offChanged',
  ],
  pan115: [
    'search',
    'checkLinks',
    'account',
    'loginStart',
    'loginPoll',
    'logout',
    'snap',
    'receive',
    'dirs',
    'torznab',
    'setTorznab',
    'testTorznab',
  ],
  discover: ['status', 'find', 'save'],
  offline: ['add', 'tasks', 'onChanged', 'offChanged'],
  dolbyVision: ['probe', 'start', 'stop'],
  progressSync: [
    'status',
    'syncNow',
    'onChanged',
    'offChanged',
    'onApplied',
    'offApplied',
  ],
  autograbUpgrade: [
    'overview',
    'setOptions',
    'replace',
    'ignore',
    'retry',
    'deleteOld',
    'runNow',
    'onChanged',
    'offChanged',
  ],
  autograbMovies: [
    'overview',
    'search',
    'status',
    'track',
    'untrack',
    'setMode',
    'setFolder',
    'grab',
    'retry',
    'runNow',
    'onChanged',
    'offChanged',
  ],
  assistant: [
    'shortcutStatus',
    'takeSummon',
    'transcribe',
    'onSummon',
    'offSummon',
    'onShortcutChanged',
    'offShortcutChanged',
  ],
  playerWindow: [
    'open',
    'close',
    'command',
    'ready',
    'progress',
    'state',
    'navigate',
    'reply',
    'onPlay',
    'offPlay',
    'onRemote',
    'offRemote',
    'onRelay',
    'offRelay',
    'onSession',
    'offSession',
    'onRoute',
    'offRoute',
  ],
}

beforeAll(async () => {
  await import('../src/preload/index')
})

describe('通用 preload', () => {
  it('重构前的 window.api 域与方法一个不少、一个不多；新增的域与方法都登记在 ADDED_API', () => {
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

describe('播放器窗口的 preload', () => {
  it('只暴露播放会话用到的域（没有片库、下载、网盘、设置面板之类主窗口的能力）', async () => {
    for (const key of Object.keys(exposed)) delete exposed[key]
    vi.resetModules()
    process.argv.push('--yingbox-player-window')
    try {
      await import('../src/preload/index')
    } finally {
      process.argv.pop()
    }
    expect(Object.keys(exposed).sort()).toEqual(
      [
        'ai',
        'aiSubtitles',
        'capture',
        'danmaku',
        'dolbyVision',
        'introDetect',
        'media',
        'mpv',
        'nowPlaying',
        'online',
        'playerWindow',
        'recap',
        'settings',
        'subtitle',
        'win',
      ].sort()
    )
    await exposed.playerWindow.ready()
    expect(invoke).toHaveBeenLastCalledWith('playerWindow:ready')
  })
})
