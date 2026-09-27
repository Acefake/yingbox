interface FileOperationResult {
  success: boolean
  data?: unknown
  error?: string
  exists?: boolean
}

// API interface
interface API {
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
    move: (srcPath: string, destPath: string, options?: { replace?: boolean }) => Promise<FileOperationResult>
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
  }
}

declare global {
  interface Window {
    api: API
  }
}

export {}
