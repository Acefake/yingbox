import { contextBridge, ipcRenderer } from 'electron'
import type { AmaneBridge } from '../shared/amane'
import type { MpvOpenOptions, MpvStatus } from '../shared/mpv'
import type { LadaJob, LadaLiveStatus } from '../shared/lada'
import { createLibraryBridge } from './library-bridge'

/** 播放列表条目：用于自动连播与失败换源 */
interface PlayerSourceItem {
  url?: string
  filePath?: string
  name?: string
  ext?: Record<string, unknown>
  siteName?: string
}

/** 播放窗口载荷 */
interface PlayerPayload {
  filePath?: string
  url?: string
  title?: string
  poster?: string
  startAt?: number
  playlist?: PlayerSourceItem[]
  index?: number
  fallbacks?: PlayerSourceItem[]
}

interface FileOperationResult {
  success: boolean
  data?: unknown
  error?: string
  exists?: boolean
}

const api = {
  amane: {
    status: () => ipcRenderer.invoke('amane:status'),
    start: () => ipcRenderer.invoke('amane:start'),
    stop: () => ipcRenderer.invoke('amane:stop'),
    configure: settings => ipcRenderer.invoke('amane:configure', settings),
    selectExecutable: () => ipcRenderer.invoke('amane:selectExecutable'),
    request: request => ipcRenderer.invoke('amane:request', request),
    resolveMedia: mediaId => ipcRenderer.invoke('amane:resolveMedia', mediaId),
    connection: () => ipcRenderer.invoke('amane:connectionInfo'),
  } satisfies AmaneBridge,
  file: {
    // 读取
    read: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:read', filePath),

    // Write content to file
    write: (filePath: string, content: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:write', filePath, content),

    // Delete file
    delete: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:delete', filePath),

    // Check if file exists
    exists: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:exists', filePath),

    // Create directory
    mkdir: (dirPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:mkdir', dirPath),

    // Read directory contents
    readdir: (dirPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:readdir', dirPath),

    // Get file stats
    stat: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:stat', filePath),

    // Copy file
    copy: (srcPath: string, destPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:copy', srcPath, destPath),

    // Move file
    move: (
      srcPath: string,
      destPath: string,
      options?: { replace?: boolean }
    ): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:move', srcPath, destPath, options),

    // Read image as data URL
    readImage: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:readImage', filePath),
  },
  http: {
    // Download file from URL
    download: (url: string, filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('http:download', url, filePath),
    // JSON request (GET/POST) via main process Node.js http/https
    fetch: (
      url: string,
      options?: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
      }
    ): Promise<{
      success: boolean
      status?: number
      data?: unknown
      error?: string
    }> => ipcRenderer.invoke('http:fetch', url, options ?? {}),
    // Fetch image as base64 data URL via main process (bypasses hotlink protection)
    fetchImage: (
      url: string,
      referer?: string
    ): Promise<{ success: boolean; data?: string; error?: string }> =>
      ipcRenderer.invoke('http:fetchImage', url, referer),
  },
  path: {
    // Join path segments
    join: (...paths: string[]): Promise<string> =>
      ipcRenderer.invoke('path:join', ...paths),

    // Resolve path
    resolve: (...paths: string[]): Promise<string> =>
      ipcRenderer.invoke('path:resolve', ...paths),

    // Get directory name
    dirname: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('path:dirname', filePath),

    // Get base name
    basename: (filePath: string, ext?: string): Promise<string> =>
      ipcRenderer.invoke('path:basename', filePath, ext),

    // Get file extension
    extname: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('path:extname', filePath),
  },

  // Dialog operations
  dialog: {
    // Open directory dialog
    openDirectory: (): Promise<{
      success: boolean
      canceled: boolean
      filePaths: string[]
      error?: string
    }> => ipcRenderer.invoke('dialog:openDirectory'),

    // Open file dialog
    openFile: (
      options?: Electron.OpenDialogOptions
    ): Promise<{
      success: boolean
      canceled: boolean
      filePaths: string[]
      error?: string
    }> => ipcRenderer.invoke('dialog:openFile', options),

    saveFile: (
      options?: Electron.SaveDialogOptions
    ): Promise<{
      success: boolean
      canceled: boolean
      filePath: string
      error?: string
    }> => ipcRenderer.invoke('dialog:saveFile', options),

    // Select directory (returns single path)
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:selectDirectory'),
  },
  config: {
    // Set download path
    setDownloadPath: (path: string): Promise<void> =>
      ipcRenderer.invoke('config:setDownloadPath', path),
  },
  app: {
    getUserDataPath: (): Promise<string> =>
      ipcRenderer.invoke('app:getUserDataPath'),
    networkIps: (): Promise<string[]> => ipcRenderer.invoke('app:networkIps'),
    // Get app version info from package.json
    getVersion: (): Promise<FileOperationResult> =>
      ipcRenderer.invoke('app:getVersion'),
  },
  update: {
    check: (): Promise<FileOperationResult> =>
      ipcRenderer.invoke('update:check'),
    download: (): Promise<FileOperationResult> =>
      ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (cb: (status: unknown) => void) =>
      ipcRenderer.on('update:status', (_e, status) => cb(status)),
    offStatus: () => ipcRenderer.removeAllListeners('update:status'),
  },
  shell: {
    openPath: (
      filePath: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('shell:openPath', filePath),
  },
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('win:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
  },
  player: {
    open: (payload: {
      filePath?: string
      url?: string
      title?: string
      poster?: string
      startAt?: number
      playlist?: PlayerSourceItem[]
      index?: number
      fallbacks?: PlayerSourceItem[]
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('player:open', payload),
    close: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('player:close'),
    getPending: (): Promise<PlayerPayload | null> =>
      ipcRenderer.invoke('player:getPending'),
    onLoad: (cb: (payload: PlayerPayload) => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: PlayerPayload
      ): void => {
        cb(payload)
      }
      ipcRenderer.on('player:load', handler)
    },
    offLoad: () => ipcRenderer.removeAllListeners('player:load'),
  },
  subtitle: {
    /**
     * 查找本地视频同目录的字幕文件。
     * 传入视频的 local:// URL（与 player 使用的是同一个地址）。
     */
    find: (
      localUrl: string
    ): Promise<{
      success: boolean
      data?: Array<{ name: string; path: string; ext: string }>
      error?: string
    }> => ipcRenderer.invoke('subtitle:find', localUrl),
    /** 读取字幕文件并统一转换为 WebVTT（自动处理 GBK/UTF-16 等编码与 srt/ass 格式） */
    read: (
      filePath: string
    ): Promise<{
      success: boolean
      data?: string
      format?: string
      error?: string
    }> => ipcRenderer.invoke('subtitle:read', filePath),
    /** OpenSubtitles 在线搜索（需主进程环境变量 YINGBOX_OPENSUBTITLES_KEY） */
    searchOnline: (options: {
      query?: string
      imdbId?: string
      episode?: number
      season?: number
      languages?: string
    }): Promise<{
      success: boolean
      data?: Array<{
        name: string
        language: string
        downloads: number
        rating?: number
        size?: number
        format: string
        fileId: number
      }>
      error?: string
      notConfigured?: boolean
    }> => ipcRenderer.invoke('subtitle:searchOnline', options),
    /** 下载在线字幕并转为 WebVTT 文本 */
    downloadOnline: (
      fileId: number
    ): Promise<{
      success: boolean
      data?: string
      format?: string
      error?: string
      notConfigured?: boolean
    }> => ipcRenderer.invoke('subtitle:downloadOnline', fileId),
  },
  lada: {
    /** 探测 lada-cli 与 ffmpeg 路径 */
    paths: () => ipcRenderer.invoke('lada:paths'),
    /** 覆盖路径（空串=恢复自动探测） */
    setPaths: (changes: { cli?: string; ffmpeg?: string }) =>
      ipcRenderer.invoke('lada:setPaths', changes),
    /** 对某个视频发起去马赛克 */
    start: (filePath: string) => ipcRenderer.invoke('lada:start', filePath),
    cancel: () => ipcRenderer.invoke('lada:cancel'),
    status: (): Promise<LadaJob | null> => ipcRenderer.invoke('lada:status'),
    /** 别的影盒实例是否在跑任务（跨实例可见） */
    otherJob: () => ipcRenderer.invoke('lada:otherJob'),
    /** 播放时优先返回已修复的产物 */
    playablePath: (
      filePath: string
    ): Promise<{ path: string; restored: boolean }> =>
      ipcRenderer.invoke('lada:playablePath', filePath),
    onProgress: (cb: (job: LadaJob | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, job: LadaJob | null): void => {
        cb(job)
      }
      ipcRenderer.on('lada:progress', handler)
    },
    offProgress: () => ipcRenderer.removeAllListeners('lada:progress'),
    onFinished: (cb: (job: LadaJob | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, job: LadaJob | null): void => {
        cb(job)
      }
      ipcRenderer.on('lada:finished', handler)
    },
    offFinished: () => ipcRenderer.removeAllListeners('lada:finished'),
    /** 「边跑边看」：起 lada + 追播，返回可直接交给播放器的 m3u8 地址 */
    startLive: (
      filePath: string
    ): Promise<{ success: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke('lada:startLive', filePath),
    stopLive: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('lada:stopLive'),
    liveStatus: () => ipcRenderer.invoke('lada:liveStatus'),
    onLive: (cb: (status: LadaLiveStatus | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: LadaLiveStatus | null): void => {
        cb(status)
      }
      ipcRenderer.on('lada:live', handler)
    },
    offLive: () => ipcRenderer.removeAllListeners('lada:live'),
    /** 暂停/继续：查询该片子的已处理进度 */
    resumeInfo: (filePath: string) => ipcRenderer.invoke('lada:resumeInfo', filePath),
    /** 继续处理（裁剩余 → 跑剩余 → 自动拼接补音轨） */
    resume: (
      filePath: string
    ): Promise<{ success: boolean; error?: string; doneSeconds?: number }> =>
      ipcRenderer.invoke('lada:resume', filePath),
    /** 接管 lada 写在 %TEMP% 里的半成品，收进缓存并登记进度 */
    adoptPartial: (filePath: string, partialPath: string) =>
      ipcRenderer.invoke('lada:adoptPartial', filePath, partialPath),
    /** 区间去码：只处理 [起点, 终点]（end <= 0 表示到片尾） */
    startRange: (
      filePath: string,
      startSeconds: number,
      endSeconds: number
    ): Promise<{ success: boolean; error?: string; output?: string; start?: number; end?: number }> =>
      ipcRenderer.invoke('lada:startRange', filePath, startSeconds, endSeconds),
    /** 区间产物拼好后触发（成功给 path，失败给 error） */
    onRangeReady: (
      cb: (info: {
        path?: string
        input: string
        start: number
        end: number
        title: string
        error?: string
      }) => void
    ) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        info: { path?: string; input: string; start: number; end: number; title: string; error?: string }
      ): void => {
        cb(info)
      }
      ipcRenderer.on('lada:range-ready', handler)
    },
    offRangeReady: () => ipcRenderer.removeAllListeners('lada:range-ready'),
    clearCache: (): Promise<{ success: boolean; freed?: number }> => ipcRenderer.invoke('lada:clearCache'),
    cacheSize: (): Promise<number> => ipcRenderer.invoke('lada:cacheSize'),
    onNotice: (cb: (text: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, text: string): void => {
        cb(text)
      }
      ipcRenderer.on('lada:notice', handler)
    },
    offNotice: () => ipcRenderer.removeAllListeners('lada:notice'),
  },
  mpv: {    open: (
      options: MpvOpenOptions
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mpv:open', options),
    pause: (paused: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:pause', paused),
    seek: (
      seconds: number,
      mode?: 'absolute' | 'relative'
    ): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:seek', seconds, mode),
    volume: (vol: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:volume', vol),
    mute: (muted: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:mute', muted),
    speed: (spd: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:speed', spd),
    setVsr: (enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:setVsr', enabled),
    setSubTrack: (id: number | false): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:setSubTrack', id),
    setAudioTrack: (id: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:setAudioTrack', id),
    addSubFile: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:addSubFile', filePath),
    playlistNext: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:playlistNext'),
    playlistPrev: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:playlistPrev'),
    playlistPlay: (index: number): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('mpv:playlistPlay', index),
    getStatus: (): Promise<MpvStatus> => ipcRenderer.invoke('mpv:getStatus'),
    quit: (): Promise<{ success: boolean }> => ipcRenderer.invoke('mpv:quit'),
    onStatus: (cb: (status: MpvStatus) => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        status: MpvStatus
      ): void => {
        cb(status)
      }
      ipcRenderer.on('mpv:status', handler)
    },
    offStatus: () => ipcRenderer.removeAllListeners('mpv:status'),
    onError: (cb: (msg: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, msg: string): void => {
        cb(msg)
      }
      ipcRenderer.on('mpv:error', handler)
    },
    offError: () => ipcRenderer.removeAllListeners('mpv:error'),
  },
  /** 媒体库引擎（P2）：调用转发到 utilityProcess，事件经 MessagePort 直达。 */
  library: createLibraryBridge(ipcRenderer),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
