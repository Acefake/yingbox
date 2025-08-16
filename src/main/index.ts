import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 1200,
    minHeight: 900,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  // 获取package.json版本信息
  ipcMain.handle('app:getVersion', async () => {
    try {
      const packageJsonPath = path.join(__dirname, '../../package.json')

      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))

      return {
        success: true,
        data: {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          author: packageJson.author,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        data: null,
      }
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('file:read', async (_, filePath: string) => {
    try {
      const data = await fs.readFile(filePath, 'utf-8')

      return { success: true, data }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
      await fs.unlink(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath)
      return { success: true, exists: true }
    } catch {
      return { success: true, exists: false }
    }
  })

  ipcMain.handle('file:mkdir', async (_, dirPath: string) => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:readdir', async (_, dirPath: string) => {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true })

      const result = files.map(file => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        isFile: file.isFile(),
      }))

      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:stat', async (_, filePath: string) => {
    try {
      const stats = await fs.stat(filePath)

      return {
        success: true,
        data: {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          mtime: stats.mtime,
          ctime: stats.ctime,
        },
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:readImage', async (_, filePath: string) => {
    try {
      const data = await fs.readFile(filePath)

      const ext = path.extname(filePath).toLowerCase()

      let mimeType = 'image/png'

      switch (ext) {
        case '.jpg':
        case '.jpeg':
          mimeType = 'image/jpeg'
          break
        case '.png':
          mimeType = 'image/png'
          break
        case '.gif':
          mimeType = 'image/gif'
          break
        case '.webp':
          mimeType = 'image/webp'
          break
        case '.svg':
          mimeType = 'image/svg+xml'
          break
      }

      const base64 = data.toString('base64')

      const dataUrl = `data:${mimeType};base64,${base64}`

      return {
        success: true,
        data: dataUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      }
    }
  })

  ipcMain.handle('file:copy', async (_, srcPath: string, destPath: string) => {
    try {
      await fs.copyFile(srcPath, destPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('file:move', async (_, srcPath: string, destPath: string) => {
    try {
      await fs.rename(srcPath, destPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('path:join', (_, ...paths: string[]) => {
    return path.join(...paths)
  })

  ipcMain.handle('path:resolve', (_, ...paths: string[]) => {
    return path.resolve(...paths)
  })

  ipcMain.handle('path:dirname', (_, filePath: string) => {
    return path.dirname(filePath)
  })

  ipcMain.handle('path:basename', (_, filePath: string, ext?: string) => {
    return path.basename(filePath, ext)
  })

  ipcMain.handle('path:extname', (_, filePath: string) => {
    return path.extname(filePath)
  })

  // Dialog operations IPC handlers
  ipcMain.handle('dialog:openDirectory', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择目录',
      })

      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        canceled: true,
        filePaths: [],
      }
    }
  })

  ipcMain.handle('dialog:openFile', async (_, options?: any) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: '选择文件',
        ...options,
      })

      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        canceled: true,
        filePaths: [],
      }
    }
  })

  ipcMain.handle('dialog:saveFile', async (_, options?: any) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '保存文件',
        ...options,
      })

      return {
        success: true,
        canceled: result.canceled,
        filePath: result.filePath,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        canceled: true,
        filePath: '',
      }
    }
  })

  // HTTP下载文件
  ipcMain.handle(
    'http:download',
    async (event: Electron.IpcMainInvokeEvent, url: string, filePath: string) => {
      try {
        const protocol = url.startsWith('https:') ? https : http

        return new Promise(resolve => {
          const request = protocol.get(url, response => {
            if (response.statusCode === 200) {
              const fileStream = fsSync.createWriteStream(filePath)

              response.pipe(fileStream)

              fileStream.on('finish', () => {
                fileStream.close()
                resolve({ success: true })
              })

              fileStream.on('error', (error: Error) => {
                resolve({ success: false, error: error.message })
              })
            } else {
              resolve({
                success: false,
                error: `HTTP ${response.statusCode}: ${response.statusMessage}`,
              })
            }
          })

          request.on('error', (error: Error) => {
            resolve({ success: false, error: error.message })
          })

          request.setTimeout(30000, () => {
            request.destroy()
            resolve({ success: false, error: '下载超时' })
          })
        })
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // 递归读取目录
  ipcMain.handle(
    'file:readdirRecursive',
    async (event: Electron.IpcMainInvokeEvent, dirPath: string) => {
      try {
        const allItems: Array<{
          name: string
          path: string
          size: number
          isDirectory: boolean
          isFile: boolean
        }> = []

        async function scanDirectory(currentPath: string): Promise<void> {
          const items = await fs.readdir(currentPath, { withFileTypes: true })

          for (const item of items) {
            // 跳过以 . 开头的文件和文件夹（如 .deletedByTMM, .DS_Store 等）
            if (item.name.startsWith('.')) {
              continue
            }

            const fullPath = path.join(currentPath, item.name)

            const stats = await fs.stat(fullPath)

            // 添加所有文件和文件夹信息
            allItems.push({
              name: item.name,
              path: fullPath,
              size: item.isFile() ? stats.size : 0,
              isDirectory: item.isDirectory(),
              isFile: item.isFile(),
            })

            if (item.isDirectory()) {
              // 递归扫描子目录
              await scanDirectory(fullPath)
            }
          }
        }

        await scanDirectory(dirPath)

        return {
          success: true,
          data: allItems,
        }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          data: [],
        }
      }
    }
  )

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
