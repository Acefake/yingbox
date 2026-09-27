import { contextBridge, ipcRenderer } from 'electron'

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
    ): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:scanMediaDirectory', dirPath, previousIndex),

    // Get file stats
    stat: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:stat', filePath),

    // Copy file
    copy: (srcPath: string, destPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:copy', srcPath, destPath),

    // Move file
    move: (srcPath: string, destPath: string, options?: { replace?: boolean }): Promise<FileOperationResult> =>
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
    getUserDataPath: (): Promise<string> => ipcRenderer.invoke('app:getUserDataPath'),
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
    getPending: (): Promise<PlayerPayload | null> => ipcRenderer.invoke('player:getPending'),
    onLoad: (cb: (payload: PlayerPayload) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: PlayerPayload): void => {
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
    find: (localUrl: string): Promise<{
      success: boolean
      data?: Array<{ name: string; path: string; ext: string }>
      error?: string
    }> => ipcRenderer.invoke('subtitle:find', localUrl),
    /** 读取字幕文件并统一转换为 WebVTT（自动处理 GBK/UTF-16 等编码与 srt/ass 格式） */
    read: (filePath: string): Promise<{
      success: boolean
      data?: string
      format?: string
      error?: string
    }> => ipcRenderer.invoke('subtitle:read', filePath),
  },
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
