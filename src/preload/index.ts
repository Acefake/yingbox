import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'

interface FileOperationResult {
  success: boolean
  data?: unknown
  error?: string
  exists?: boolean
}

const api = {
  file: {
    // Read file content
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

    // Read directory contents recursively
    readdirRecursive: (dirPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:readdirRecursive', dirPath),

    // Get file stats
    stat: (filePath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:stat', filePath),

    // Copy file
    copy: (srcPath: string, destPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:copy', srcPath, destPath),

    // Move file
    move: (srcPath: string, destPath: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('file:move', srcPath, destPath),

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
      options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
    ): Promise<{ success: boolean; status?: number; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('http:fetch', url, options ?? {}),
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
  },
  app: {
    // Get app version info from package.json
    getVersion: (): Promise<FileOperationResult> =>
      ipcRenderer.invoke('app:getVersion'),
  },
  shell: {
    openPath: (filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('shell:openPath', filePath),
  },
  player: {
    open: (filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('player:open', filePath),
  },
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('win:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
  },
  detail: {
    open: (itemData: unknown): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('detail:open', itemData),
    getData: (): Promise<unknown> =>
      ipcRenderer.invoke('detail:getData'),
    onUpdate: (cb: (data: unknown) => void) =>
      ipcRenderer.on('detail:update', (_e, data) => cb(data)),
    offUpdate: () =>
      ipcRenderer.removeAllListeners('detail:update'),
  },
  scraper: {
    fetchMeta: (avid: string) => ipcRenderer.invoke('scraper:fetchMeta', avid),
    scrape: (avid: string) => ipcRenderer.invoke('scraper:scrape', avid),
  },
  downloader: {
    start: (avid: string): void => ipcRenderer.send('downloader:start', avid),
    cancel: (avid: string): void => ipcRenderer.send('downloader:cancel', avid),
    onLog: (cb: (data: { avid: string; text: string }) => void) => {
      ipcRenderer.on('downloader:log', (_e, data) => cb(data))
    },
    onDone: (cb: (data: { avid: string; code: number }) => void) => {
      ipcRenderer.on('downloader:done', (_e, data) => cb(data))
    },
    offLog: () => ipcRenderer.removeAllListeners('downloader:log'),
    offDone: () => ipcRenderer.removeAllListeners('downloader:done'),
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
