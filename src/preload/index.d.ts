import { ElectronAPI } from '@electron-toolkit/preload'

// File operation result interface
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
  }
  path: {
    join: (...paths: string[]) => Promise<string>
    resolve: (...paths: string[]) => Promise<string>
    dirname: (filePath: string) => Promise<string>
    basename: (filePath: string, ext?: string) => Promise<string>
    extname: (filePath: string) => Promise<string>
  }
  dialog: {
      openDirectory: () => Promise<{success: boolean, canceled: boolean, filePaths: string[], error?: string}>
      openFile: (options?: Electron.OpenDialogOptions) => Promise<{success: boolean, canceled: boolean, filePaths: string[], error?: string}>
      saveFile: (options?: Electron.SaveDialogOptions) => Promise<{success: boolean, canceled: boolean, filePath: string, error?: string}>
    }
    app: {
      getVersion: () => Promise<FileOperationResult>
    }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
