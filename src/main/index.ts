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
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.svg?asset'

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
function saveConfig() {
  try {
    const config = { downloadPath }
    fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('Failed to save config:', err)
  }
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('update:status', {
    status: 'checking',
  })
})

autoUpdater.on('update-available', info => {
  mainWindow?.webContents.send('update:status', {
    status: 'available',
    info,
  })
})

autoUpdater.on('update-not-available', info => {
  mainWindow?.webContents.send('update:status', {
    status: 'not-available',
    info,
  })
})

autoUpdater.on('download-progress', progress => {
  mainWindow?.webContents.send('update:status', {
    status: 'downloading',
    progress,
  })
})

autoUpdater.on('update-downloaded', info => {
  mainWindow?.webContents.send('update:status', {
    status: 'downloaded',
    info,
  })
})

autoUpdater.on('error', error => {
  mainWindow?.webContents.send('update:status', {
    status: 'error',
    error: error.message,
  })
})

function getScreenBasedSize(ratio = 0.85, minW = 1200, minH = 900) {
  const primary = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = primary.workAreaSize
  const w = Math.max(Math.floor(sw * ratio), minW)
  const h = Math.max(Math.floor(sh * ratio), minH)
  return { width: w, height: h }
}

function createWindow(): void {
  const { width, height } = getScreenBasedSize(0.85, 1200, 900)
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1200,
    minHeight: 900,
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
  protocol.handle('local', async request => {
    const url = new URL(request.url)
    const host = url.host
    const pathname = decodeURIComponent(url.pathname)
    const filePath = host
      ? `${host.toUpperCase()}:${pathname}`
      : pathname.replace(/^\//, '')
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.m4v': 'video/mp4',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    try {
      await fs.access(filePath)
    } catch {
      return new Response(null, { status: 404 })
    }

    // 对于图片和小文件使用 Buffer，对于视频使用流式处理
    const isMedia = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.flv'].includes(ext)

    if (isMedia) {
      // 视频文件使用流式处理，但每次创建新流
      const stream = fsSync.createReadStream(filePath)
      return new Response(stream as any, {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } else {
      // 图片和其他小文件使用 Buffer
      try {
        const buffer = await fs.readFile(filePath)
        return new Response(buffer, {
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=86400',
          },
        })
      } catch {
        return new Response(null, { status: 500 })
      }
    }
  })

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
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    try {
      if (srcPath === destPath) return { success: true }

      try {
        await fs.access(destPath)
        return { success: false, error: `目标已存在: ${destPath}`, code: 'EEXIST' }
      } catch {
      }

      let lastError: NodeJS.ErrnoException | null = null
      for (let i = 0; i < 5; i++) {
        try {
          await fs.rename(srcPath, destPath)
          return { success: true }
        } catch (error) {
          const err = error as NodeJS.ErrnoException
          lastError = err
          if (err.code === 'EXDEV') {
            await fs.cp(srcPath, destPath, { recursive: true })
            await fs.rm(srcPath, { recursive: true, force: true })
            return { success: true }
          }
          if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(err.code || '')) break
          await sleep(300 * (i + 1))
        }
      }
      return {
        success: false,
        error: lastError?.message || 'move failed',
        code: lastError?.code,
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      return { success: false, error: err.message, code: err.code }
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
    downloadPath = path
    saveConfig()
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

  // HTTP JSON 请求（用于 MetaTube 等自部署服务）
  ipcMain.handle(
    'http:fetch',
    async (
      _event: Electron.IpcMainInvokeEvent,
      url: string,
      options: {
        method?: string
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
      } = {}
    ) => {
      try {
        const protocol = url.startsWith('https:') ? https : http
        const timeout = options.timeoutMs ?? 30000

        return new Promise(resolve => {
          const urlObj = new URL(url)
          const reqOptions: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method ?? 'GET',
            headers: options.headers ?? {},
          }

          const req = protocol.request(reqOptions, res => {
            let data = ''
            res.setEncoding('utf-8')
            res.on('data', chunk => {
              data += chunk
            })
            res.on('end', () => {
              try {
                const json = JSON.parse(data)
                resolve({ success: true, status: res.statusCode, data: json })
              } catch {
                resolve({
                  success: true,
                  status: res.statusCode,
                  data,
                  raw: true,
                })
              }
            })
          })

          req.setTimeout(timeout, () => {
            req.destroy()
            resolve({ success: false, error: '请求超时' })
          })

          req.on('error', (err: Error) => {
            resolve({ success: false, error: err.message })
          })

          if (options.body) req.write(options.body)
          req.end()
        })
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // 通过主进程代理加载图片（绕过防盗链）
  ipcMain.handle(
    'http:fetchImage',
    async (
      _event: Electron.IpcMainInvokeEvent,
      url: string,
      referer?: string
    ) => {
      try {
        const protocol = url.startsWith('https:') ? https : http
        return new Promise(resolve => {
          const urlObj = new URL(url)
          const reqOptions: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https:') ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Referer: referer || `${urlObj.protocol}//${urlObj.hostname}/`,
              Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
            },
          }
          const req = protocol.request(reqOptions, res => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 400) {
                resolve({ success: false, error: `HTTP ${res.statusCode}` })
                return
              }
              const buffer = Buffer.concat(chunks)
              const contentType = res.headers['content-type'] || 'image/jpeg'
              const base64 = buffer.toString('base64')
              resolve({
                success: true,
                data: `data:${contentType};base64,${base64}`,
              })
            })
          })
          req.setTimeout(15000, () => {
            req.destroy()
            resolve({ success: false, error: '超时' })
          })
          req.on('error', (err: Error) =>
            resolve({ success: false, error: err.message })
          )
          req.end()
        })
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // HTTP下载文件
  ipcMain.handle(
    'http:download',
    async (
      _event: Electron.IpcMainInvokeEvent,
      url: string,
      filePath: string
    ) => {
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
      const env = { ...process.env }
      if (downloadPath) {
        env.MISSAV_VIDEO_PATH = downloadPath
        console.log('[Go] Using custom download path:', downloadPath)
      }

      try {
        goProc = spawn(goExe, [], { cwd: goCwd, env, shell: true })
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

    app.on('will-quit', () => {
      if (goProc) {
        console.log('[Go] Killing backend process...')
        goProc.kill()
      }
    })
  }

  // ── Python 刮削 / 下载 ──────────────────────────────────

  // Python 刮削/下载已迁移到 Go 后端

  ipcMain.handle('shell:openPath', async (_, filePath: string) => {
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || undefined }
  })

  // 详情窗口：单例 + 待传数据
  let pendingDetailData: unknown = null
  let detailWin: BrowserWindow | null = null

  ipcMain.handle('detail:open', async (_, itemData: unknown) => {
    pendingDetailData = itemData

    // 已有窗口：推送新数据后聚焦，不重新创建
    if (detailWin && !detailWin.isDestroyed()) {
      detailWin.webContents.send('detail:update', itemData)
      if (detailWin.isMinimized()) detailWin.restore()
      detailWin.focus()
      return { success: true }
    }

    const { width: dw, height: dh } = getScreenBasedSize(0.75, 900, 680)
    detailWin = new BrowserWindow({
      width: dw,
      height: dh,
      minWidth: 800,
      minHeight: 600,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false,
      },
    })
    detailWin.on('closed', () => {
      detailWin = null
      pendingDetailData = null
    })
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      detailWin.loadURL(
        process.env['ELECTRON_RENDERER_URL'] + '#/online-detail'
      )
      detailWin.webContents.openDevTools()
    } else {
      detailWin.loadFile(join(__dirname, '../renderer/index.html'), {
        hash: '/online-detail',
      })
    }
    return { success: true }
  })

  ipcMain.handle('detail:getData', () => pendingDetailData)

  ipcMain.handle('player:open', async (_, filePath: string, customTitle?: string) => {
    // 区分在线 URL 和本地文件
    const isOnlineUrl = filePath.startsWith('http://') || filePath.startsWith('https://')
    const videoUrl = isOnlineUrl ? filePath : 'file:///' + filePath.replace(/\\/g, '/')
    const title = customTitle || (isOnlineUrl ? '在线播放' : path.basename(filePath))
    const playerHtml = join(__dirname, '../../resources/player.html')
    const playerPreload = join(__dirname, '../../resources/player-preload.js')
    const { width: pw, height: ph } = getScreenBasedSize(0.8, 900, 560)
    const win = new BrowserWindow({
      width: pw,
      height: ph,
      minWidth: 640,
      minHeight: 400,
      backgroundColor: '#000000',
      title,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        webSecurity: false,
        nodeIntegration: false,
        contextIsolation: true,
        preload: playerPreload,
      },
    })
    const onMin = (_e: Electron.IpcMainEvent) => {
      if (_e.sender === win.webContents) win.minimize()
    }
    const onClose = (_e: Electron.IpcMainEvent) => {
      if (_e.sender === win.webContents) win.close()
    }
    ipcMain.on('player-win:minimize', onMin)
    ipcMain.on('player-win:close', onClose)
    win.on('closed', () => {
      ipcMain.off('player-win:minimize', onMin)
      ipcMain.off('player-win:close', onClose)
    })
    const query =
      '?src=' +
      encodeURIComponent(videoUrl) +
      '&title=' +
      encodeURIComponent(title)
    win.loadFile(playerHtml, { search: query })
    return { success: true }
  })

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
