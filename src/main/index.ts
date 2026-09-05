import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import { spawn } from 'child_process'
import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.svg?asset'
import { atomicWrite, movePath } from './file-operations'
import { serveLocalMedia } from './local-media'
import { scanMediaDirectory } from './media-scanner'
import { downloadFile, fetchHttp, readLimited } from './http-client'

Menu.setApplicationMenu(null)

app.commandLine.appendSwitch(
  'enable-features',
  'EnableDrDc,CanvasOopRasterization'
)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: { secure: true, standard: true, stream: true, bypassCSP: true },
  },
])

let mainWindow: BrowserWindow | null = null

// 下载路径配置
const configPath = join(app.getPath('userData'), 'config.json')
let downloadPath = ''

// 加载配置
try {
  if (fsSync.existsSync(configPath)) {
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'))
    downloadPath = config.downloadPath || ''
  }
} catch (err) {
  console.error('Failed to load config:', err)
}

// 保存配置
async function saveConfig(): Promise<void> {
  await atomicWrite(configPath, JSON.stringify({ downloadPath }, null, 2))
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

// 检查更新
autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('update:status', {
    status: 'checking',
  })
})

// 更新可用
autoUpdater.on('update-available', info => {
  mainWindow?.webContents.send('update:status', {
    status: 'available',
    info,
  })
})

// 更新不可用
autoUpdater.on('update-not-available', info => {
  mainWindow?.webContents.send('update:status', {
    status: 'not-available',
    info,
  })
})

// 下载进度
autoUpdater.on('download-progress', progress => {
  mainWindow?.webContents.send('update:status', {
    status: 'downloading',
    progress,
  })
})

// 下载完成
autoUpdater.on('update-downloaded', info => {
  mainWindow?.webContents.send('update:status', {
    status: 'downloaded',
    info,
  })
})

// 下载错误
autoUpdater.on('error', error => {
  mainWindow?.webContents.send('update:status', {
    status: 'error',
    error: error.message,
  })
})

function getScreenBasedSize(ratio = 0.85, minW = 1200, minH = 900) {
  const primary = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = primary.workAreaSize
  const w = Math.min(sw, Math.max(Math.floor(sw * ratio), minW))
  const h = Math.min(sh, Math.max(Math.floor(sh * ratio), minH))
  return { width: w, height: h }
}

function registerWindowHandlers(): void {
  ipcMain.handle('win:minimize', event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('win:maximize', event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('win:close', event => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('win:isMaximized', event => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // 获取package.json版本信息
  ipcMain.handle('app:getVersion', async () => {
    try {
      const packageJsonPath = path.join(__dirname, '../../package.json')

      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, 'utf-8')
      )

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

  ipcMain.handle('update:check', async () => {
    if (is.dev) {
      return { success: false, error: '开发环境不检查更新' }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, data: result?.updateInfo ?? null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

}

function createWindow(): void {
  const { width, height } = getScreenBasedSize(0.85, 1200, 900)
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1200, width),
    minHeight: Math.min(900, height),
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
    },
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    if (!is.dev) {
      autoUpdater.checkForUpdates().catch(error => {
        console.warn('[Updater] check failed:', error)
      })
    }
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
  electronApp.setAppUserModelId('com.yingbox.app')

  // 覆盖 CSP，允许外部媒体（m3u8/mp4）和 blob URL 加载
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [
      "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; media-src * blob: data:; img-src * blob: data:; connect-src *",
    ]
    callback({ responseHeaders: headers })
  })

  // 注册 local:// 协议，允许渲染层流式读取本地文件（用于内置播放器）
  protocol.handle('local', serveLocalMedia)

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
      await atomicWrite(filePath, content)
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

  // 媒体库扫描：在主进程一次完成遍历，避免渲染层对每个文件进行 IPC 往返。
  ipcMain.handle('file:scanMediaDirectory', async (_, dirPath: string) => {
    try { return { success: true, ...await scanMediaDirectory(dirPath) } }
    catch (error) { return { success: false, error: (error as Error).message } }
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

  ipcMain.handle('file:move', async (_, srcPath: string, destPath: string, options?: { replace?: boolean }) => {
    try {
      await movePath(srcPath, destPath, options?.replace === true)
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

  ipcMain.handle('dialog:selectDirectory', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择下载目录',
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    } catch (error) {
      console.error('Failed to select directory:', error)
      return null
    }
  })

  // Config operations
  ipcMain.handle('config:setDownloadPath', async (_, path: string) => {
    if (typeof path !== 'string' || !path.trim()) throw new Error('下载目录不能为空')
    const stats = await fs.stat(path)
    if (!stats.isDirectory()) throw new Error('下载路径必须是目录')
    const previous = downloadPath
    downloadPath = path
    try { await saveConfig() } catch (error) { downloadPath = previous; throw error }
    console.log('Download path set to:', path)
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

  ipcMain.handle('http:fetch', async (_, url: string, options: {
    method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number
  } = {}) => {
    try {
      const response = await fetchHttp(url, {
        method: options.method ?? 'GET', headers: options.headers, body: options.body,
      }, options.timeoutMs ?? 30000)
      const text = (await readLimited(response)).toString('utf-8')
      try { return { success: true, status: response.status, data: JSON.parse(text) } }
      catch { return { success: true, status: response.status, data: text, raw: true } }
    } catch (error) { return { success: false, error: (error as Error).message } }
  })

  ipcMain.handle('http:fetchImage', async (_, url: string, referer?: string) => {
    try {
      const response = await fetchHttp(url, { headers: {
        'User-Agent': 'Mozilla/5.0', Referer: referer || new URL(url).origin + '/',
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
      } }, 15000)
      const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      if (!contentType.startsWith('image/')) { await response.body?.cancel(); throw new Error('响应不是图片') }
      const buffer = await readLimited(response)
      return { success: true, data: `data:${contentType};base64,${buffer.toString('base64')}` }
    } catch (error) { return { success: false, error: (error as Error).message } }
  })

  ipcMain.handle('http:download', async (_, url: string, filePath: string) => {
    try { await downloadFile(url, filePath); return { success: true } }
    catch (error) { return { success: false, error: (error as Error).message } }
  })

  // 递归读取目录
  ipcMain.handle(
    'file:readdirRecursive',
    async (_event: Electron.IpcMainInvokeEvent, dirPath: string) => {
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

  // ── Go 后端 ───────────────────────────────────────────────
  // 开发环境: packages/services/backend/main.exe (由 pnpm dev:backend 启动)
  // 打包后: resources/backend/main.exe
  const isDev = is.dev
  console.log('[Go] isDev:', isDev, 'resourcesPath:', process.resourcesPath)

  // 开发模式下，Go 后端由 pnpm dev:backend 启动，不再重复启动
  if (isDev) {
    console.log('[Go] Development mode: backend should be started by pnpm dev:backend')
  } else {
    const goExe = join(
      process.resourcesPath,
      'backend',
      process.platform === 'win32' ? 'main.exe' : 'main'
    )
    const goCwd = join(process.resourcesPath, 'backend')
    let goProc: ReturnType<typeof spawn> | null = null

    console.log('[Go] Looking for backend at:', goExe)

    if (fsSync.existsSync(goExe)) {
      console.log('[Go] Starting backend from:', goExe)
      // 设置环境变量
      const env: NodeJS.ProcessEnv = { ...process.env, YINGBOX_CONFIG_PATH: configPath, PROJECT_ROOT: app.getAppPath(), NODE_EXECUTABLE: process.execPath }
      env.ELECTRON_RUN_AS_NODE = '1'
      if (downloadPath) {
        env.MISSAV_VIDEO_PATH = downloadPath
        console.log('[Go] Using custom download path:', downloadPath)
      }

      try {
        goProc = spawn(goExe, [], { cwd: goCwd, env, shell: false, windowsHide: true })
        goProc.stdout?.on('data', (d: Buffer) =>
          console.log('[Go stdout]', d.toString().trim())
        )
        goProc.stderr?.on('data', (d: Buffer) =>
          console.error('[Go stderr]', d.toString().trim())
        )
        goProc.on('exit', (code, signal) => {
          console.log('[Go] exited with code', code, 'signal:', signal)
        })
        goProc.on('error', (err) => {
          console.error('[Go] spawn error:', err.message)
        })
        console.log('[Go] Backend process started with PID:', goProc.pid)
      } catch (err) {
        console.error('[Go] Failed to start backend:', err)
      }
    } else {
      console.error('[Go] backend exe not found:', goExe)
      // 尝试列出 resources 目录内容
      try {
        const resourcesDir = join(process.resourcesPath, 'backend')
        if (fsSync.existsSync(resourcesDir)) {
          const files = fsSync.readdirSync(resourcesDir)
          console.log('[Go] Resources/backend contents:', files)
        } else {
          console.error('[Go] Resources/backend directory does not exist')
        }
      } catch (e) {
        console.error('[Go] Error listing resources:', e)
      }
    }

    let stoppingBackend = false
    app.on('before-quit', event => {
      if (!goProc || stoppingBackend) return
      event.preventDefault()
      stoppingBackend = true
      const child = goProc
      const finish = () => { goProc = null; app.quit() }
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        killer.once('error', () => { child.kill(); finish() })
        killer.once('exit', finish)
      } else {
        child.once('exit', finish)
        child.kill('SIGTERM')
        setTimeout(() => { child.kill('SIGKILL'); finish() }, 5000).unref()
      }
    })
  }

  // ── Python 刮削 / 下载 ──────────────────────────────────

  // Python 刮削/下载已迁移到 Go 后端

  ipcMain.handle('shell:openPath', async (_, filePath: string) => {
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || undefined }
  })

  registerWindowHandlers()
  createWindow()

  // 注册 DevTools 快捷键
  const registerDevToolsShortcut = () => {
    // F12 切换 DevTools
    globalShortcut.register('F12', () => {
      if (mainWindow) {
        mainWindow.webContents.toggleDevTools()
      }
    })

    // Ctrl+Shift+I (Windows/Linux) 或 Cmd+Opt+I (macOS) 切换 DevTools
    const accelerator =
      process.platform === 'darwin' ? 'Command+Option+I' : 'Control+Shift+I'
    globalShortcut.register(accelerator, () => {
      if (mainWindow) {
        mainWindow.webContents.toggleDevTools()
      }
    })
  }

  registerDevToolsShortcut()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 注销所有快捷键
  globalShortcut.unregisterAll()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
