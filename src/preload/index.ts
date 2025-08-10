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
  },
  path: {
    // Join path segments
    join: (...paths: string[]): Promise<string> => ipcRenderer.invoke('path:join', ...paths),

    // Resolve path
    resolve: (...paths: string[]): Promise<string> => ipcRenderer.invoke('path:resolve', ...paths),

    // Get directory name
    dirname: (filePath: string): Promise<string> => ipcRenderer.invoke('path:dirname', filePath),

    // Get base name
    basename: (filePath: string, ext?: string): Promise<string> =>
      ipcRenderer.invoke('path:basename', filePath, ext),

    // Get file extension
    extname: (filePath: string): Promise<string> => ipcRenderer.invoke('path:extname', filePath),
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
    getVersion: (): Promise<FileOperationResult> => ipcRenderer.invoke('app:getVersion'),
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
