import type { AmaneBridge } from '../shared/amane'
import type { MpvOpenOptions, MpvStatus } from '../shared/mpv'
import type { LadaJob, LadaLiveStatus, LadaPaths } from '../shared/lada'
import type { LibraryBridge } from '../shared/library/ipc'

interface FileOperationResult {
  success: boolean
  data?: unknown
  error?: string
  exists?: boolean
}

// API interface
interface API {
  amane: AmaneBridge
  file: {
    read: (filePath: string) => Promise<FileOperationResult>
    write: (filePath: string, content: string) => Promise<FileOperationResult>
    delete: (filePath: string) => Promise<FileOperationResult>
    exists: (filePath: string) => Promise<FileOperationResult>
    mkdir: (dirPath: string) => Promise<FileOperationResult>
    readdir: (dirPath: string) => Promise<FileOperationResult>
    scanMediaDirectory: (
      dirPath: string,
      previousIndex?: Array<{
        path: string
        mtime: number
        size: number
        name?: string
        isDirectory?: boolean
        isFile?: boolean
      }>
    ) => Promise<FileOperationResult>
    stat: (filePath: string) => Promise<FileOperationResult>
    copy: (srcPath: string, destPath: string) => Promise<FileOperationResult>
    move: (
      srcPath: string,
      destPath: string,
      options?: { replace?: boolean }
    ) => Promise<FileOperationResult>
    readImage: (filePath: string) => Promise<FileOperationResult>
  }
  http: {
    download: (url: string, filePath: string) => Promise<FileOperationResult>
    fetch: (
      url: string,
      options?: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
      }
    ) => Promise<{
      success: boolean
      status?: number
      data?: unknown
      error?: string
    }>
    fetchImage: (
      url: string,
      referer?: string
    ) => Promise<{ success: boolean; data?: string; error?: string }>
  }
  path: {
    join: (...paths: string[]) => Promise<string>
    resolve: (...paths: string[]) => Promise<string>
    dirname: (filePath: string) => Promise<string>
    basename: (filePath: string, ext?: string) => Promise<string>
    extname: (filePath: string) => Promise<string>
  }
  config: { setDownloadPath: (path: string) => Promise<void> }
  dialog: {
    selectDirectory: () => Promise<string | null>
    openDirectory: () => Promise<{
      success: boolean
      canceled: boolean
      filePaths: string[]
      error?: string
    }>
    openFile: (options?: Electron.OpenDialogOptions) => Promise<{
      success: boolean
      canceled: boolean
      filePaths: string[]
      error?: string
    }>
    saveFile: (options?: Electron.SaveDialogOptions) => Promise<{
      success: boolean
      canceled: boolean
      filePath: string
      error?: string
    }>
  }
  app: {
    getUserDataPath: () => Promise<string>
    networkIps: () => Promise<string[]>
    getVersion: () => Promise<FileOperationResult>
  }
  update: {
    check: () => Promise<FileOperationResult>
    download: () => Promise<FileOperationResult>
    install: () => Promise<void>
    onStatus: (cb: (status: unknown) => void) => void
    offStatus: () => void
  }
  shell: {
    openPath: (
      filePath: string
    ) => Promise<{ success: boolean; error?: string }>
  }
  win: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  player: {
    open: (payload: {
      filePath?: string
      url?: string
      title?: string
      poster?: string
      startAt?: number
      playlist?: Array<{
        url?: string
        filePath?: string
        name?: string
        ext?: Record<string, unknown>
        siteName?: string
      }>
      index?: number
      fallbacks?: Array<{
        url?: string
        filePath?: string
        name?: string
        ext?: Record<string, unknown>
        siteName?: string
      }>
    }) => Promise<{ success: boolean; error?: string }>
    close: () => Promise<{ success: boolean }>
    getPending: () => Promise<{
      filePath?: string
      url?: string
      title?: string
      poster?: string
      startAt?: number
      playlist?: Array<{
        url?: string
        filePath?: string
        name?: string
        ext?: Record<string, unknown>
        siteName?: string
      }>
      index?: number
      fallbacks?: Array<{
        url?: string
        filePath?: string
        name?: string
        ext?: Record<string, unknown>
        siteName?: string
      }>
    } | null>
    onLoad: (
      cb: (payload: {
        filePath?: string
        url?: string
        title?: string
        poster?: string
        startAt?: number
        playlist?: Array<{
          url?: string
          filePath?: string
          name?: string
          ext?: Record<string, unknown>
          siteName?: string
        }>
        index?: number
        fallbacks?: Array<{
          url?: string
          filePath?: string
          name?: string
          ext?: Record<string, unknown>
          siteName?: string
        }>
      }) => void
    ) => void
    offLoad: () => void
  }
  subtitle: {
    /** 查找本地视频同目录的字幕文件（传入视频的 local:// URL） */
    find: (localUrl: string) => Promise<{
      success: boolean
      data?: Array<{ name: string; path: string; ext: string }>
      error?: string
    }>
    /** 读取字幕并统一转换为 WebVTT（自动处理 GBK/UTF-16 编码与 srt/ass 格式） */
    read: (filePath: string) => Promise<{
      success: boolean
      data?: string
      format?: string
      error?: string
    }>
    /** OpenSubtitles 在线搜索（需主进程环境变量 YINGBOX_OPENSUBTITLES_KEY） */
    searchOnline: (options: {
      query?: string
      imdbId?: string
      episode?: number
      season?: number
      languages?: string
    }) => Promise<{
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
    }>
    /** 下载在线字幕并转为 WebVTT 文本 */
    downloadOnline: (fileId: number) => Promise<{
      success: boolean
      data?: string
      format?: string
      error?: string
      notConfigured?: boolean
    }>
  }
  lada: {
    /** 探测 lada-cli 与 ffmpeg 路径 */
    paths: () => Promise<LadaPaths>
    /** 覆盖路径（空串=恢复自动探测） */
    setPaths: (changes: { cli?: string; ffmpeg?: string }) => Promise<LadaPaths>
    /** 对某个视频发起去马赛克 */
    start: (
      filePath: string
    ) => Promise<{ success: boolean; job?: LadaJob; error?: string }>
    cancel: () => Promise<{ success: boolean }>
    status: () => Promise<LadaJob | null>
    /** 别的影盒实例是否在跑任务（跨实例可见） */
    otherJob: () => Promise<{
      pid: number
      input?: string
      startedAt?: number
    } | null>
    /** 播放时优先返回已修复的产物 */
    playablePath: (
      filePath: string
    ) => Promise<{ path: string; restored: boolean }>
    onProgress: (cb: (job: LadaJob | null) => void) => void
    offProgress: () => void
    onFinished: (cb: (job: LadaJob | null) => void) => void
    offFinished: () => void
    /** 「边跑边看」：起 lada + 追播，返回可直接交给播放器的 m3u8 地址 */
    startLive: (
      filePath: string
    ) => Promise<{ success: boolean; url?: string; error?: string }>
    stopLive: () => Promise<{ success: boolean }>
    liveStatus: () => Promise<LadaLiveStatus | null>
    onLive: (cb: (status: LadaLiveStatus | null) => void) => void
    offLive: () => void
    /** 暂停/继续：查询该片子的已处理进度 */
    resumeInfo: (filePath: string) => Promise<{
      input: string
      doneSeconds: number
      parts: number
      preset: string
      updatedAt: number
    } | null>
    /** 继续处理（裁剩余 → 跑剩余 → 自动拼接补音轨） */
    resume: (
      filePath: string
    ) => Promise<{ success: boolean; error?: string; doneSeconds?: number }>
    /** 接管 lada 写在 %TEMP% 里的半成品，收进缓存并登记进度 */
    adoptPartial: (
      filePath: string,
      partialPath: string
    ) => Promise<{
      input: string
      doneSeconds: number
      parts: number
      preset: string
      updatedAt: number
    } | null>
    clearCache: () => Promise<{ success: boolean; freed?: number }>
    cacheSize: () => Promise<number>
    /** 区间去码：只处理 [起点, 终点]（endSeconds <= 0 表示到片尾） */
    startRange: (
      filePath: string,
      startSeconds: number,
      endSeconds: number
    ) => Promise<{
      success: boolean
      error?: string
      output?: string
      start?: number
      end?: number
    }>
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
    ) => void
    offRangeReady: () => void
    onNotice: (cb: (text: string) => void) => void
    offNotice: () => void
  }
  mpv: {
    open: (
      options: MpvOpenOptions
    ) => Promise<{ success: boolean; error?: string }>
    pause: (paused: boolean) => Promise<{ success: boolean }>
    seek: (
      seconds: number,
      mode?: 'absolute' | 'relative'
    ) => Promise<{ success: boolean }>
    volume: (vol: number) => Promise<{ success: boolean }>
    mute: (muted: boolean) => Promise<{ success: boolean }>
    speed: (spd: number) => Promise<{ success: boolean }>
    setVsr: (enabled: boolean) => Promise<{ success: boolean }>
    setSubTrack: (id: number | false) => Promise<{ success: boolean }>
    setAudioTrack: (id: number) => Promise<{ success: boolean }>
    addSubFile: (filePath: string) => Promise<{ success: boolean }>
    playlistNext: () => Promise<{ success: boolean }>
    playlistPrev: () => Promise<{ success: boolean }>
    playlistPlay: (index: number) => Promise<{ success: boolean }>
    getStatus: () => Promise<MpvStatus>
    quit: () => Promise<{ success: boolean }>
    onStatus: (cb: (status: MpvStatus) => void) => void
    offStatus: () => void
    onError: (cb: (msg: string) => void) => void
    offError: () => void
  }
  /** 媒体库引擎：增删媒体库、扫描、分页查询、条目详情、事件订阅。 */
  library: LibraryBridge
}

declare global {
  interface Window {
    api: API
  }
}

export {}
