import { ElectronAPI } from '@electron-toolkit/preload'

// File operation result interface
interface AVMetadata {
  avid: string
  title: string
  cover: string
  release_date: string
  duration: string
  description: string
  keywords: string[]
  actress: Record<string, string>
  fanarts: string[]
  error?: string
}

interface DownloaderLogData {
  avid: string
  text: string
}

interface DownloaderDoneData {
  avid: string
  code: number
}

interface FileOperationResult {
  success: boolean
  data?: unknown
  error?: string
  exists?: boolean
}

interface FileInfo {
  name: string
  isDirectory: boolean
  isFile: boolean
}

interface FileStats {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: Date
  ctime: Date
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
    readdirRecursive: (dirPath: string) => Promise<FileOperationResult>
    stat: (filePath: string) => Promise<FileOperationResult>
    copy: (srcPath: string, destPath: string) => Promise<FileOperationResult>
    move: (srcPath: string, destPath: string) => Promise<FileOperationResult>
    readImage: (filePath: string) => Promise<FileOperationResult>
  }
  http: {
    download: (url: string, filePath: string) => Promise<FileOperationResult>
    fetch: (
      url: string,
      options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
    ) => Promise<{ success: boolean; status?: number; data?: unknown; error?: string }>
    fetchImage: (url: string, referer?: string) => Promise<{ success: boolean; data?: string; error?: string }>
  }
  path: {
    join: (...paths: string[]) => Promise<string>
    resolve: (...paths: string[]) => Promise<string>
    dirname: (filePath: string) => Promise<string>
    basename: (filePath: string, ext?: string) => Promise<string>
    extname: (filePath: string) => Promise<string>
  }
  dialog: {
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
    getVersion: () => Promise<FileOperationResult>
  }
  shell: {
    openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
  }
  player: {
    open: (filePath: string) => Promise<{ success: boolean }>
  }
  win: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  detail: {
    open: (itemData: unknown) => Promise<{ success: boolean }>
    getData: () => Promise<unknown>
  }
  scraper: {
    fetchMeta: (avid: string) => Promise<AVMetadata>
    scrape: (avid: string) => Promise<AVMetadata & { _log?: string }>
  }
  downloader: {
    start: (avid: string) => void
    cancel: (avid: string) => void
    onLog: (cb: (data: DownloaderLogData) => void) => void
    onDone: (cb: (data: DownloaderDoneData) => void) => void
    offLog: () => void
    offDone: () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
