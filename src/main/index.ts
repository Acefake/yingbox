import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  session,
  shell,
} from 'electron'
import { spawn, ChildProcess } from 'child_process'
import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'

Menu.setApplicationMenu(null)

app.commandLine.appendSwitch('enable-features', 'EnableDrDc,CanvasOopRasterization')
app.commandLine.appendSwitch('force-color-profile', 'hdr')
app.commandLine.appendSwitch('enable-hdr')

protocol.registerSchemesAsPrivileged([
  { scheme: 'local', privileges: { secure: true, standard: true, stream: true, bypassCSP: true } },
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
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

  ipcMain.handle('win:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('win:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('win:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('win:isMaximized', (event) => {
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

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
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

  // 覆盖 CSP，允许外部媒体（m3u8/mp4）和 blob URL 加载
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Content-Security-Policy'] = [
      "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; media-src * blob: data:; img-src * blob: data:; connect-src *"
    ]
    callback({ responseHeaders: headers })
  })

  // 注册 local:// 协议，允许渲染层流式读取本地文件（用于内置播放器）
  protocol.handle('local', async (request) => {
    const url = new URL(request.url)
    const host = url.host
    const pathname = decodeURIComponent(url.pathname)
    const filePath = host ? `${host.toUpperCase()}:${pathname}` : pathname.replace(/^\//, '')
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
      '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif',
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    try {
      await fs.access(filePath)
    } catch {
      return new Response(null, { status: 404 })
    }
    return new Response(fsSync.createReadStream(filePath) as any, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400',
      },
    })
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

  // HTTP JSON 请求（用于 MetaTube 等自部署服务）
  ipcMain.handle(
    'http:fetch',
    async (
      _event: Electron.IpcMainInvokeEvent,
      url: string,
      options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
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
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
              try {
                const json = JSON.parse(data)
                resolve({ success: true, status: res.statusCode, data: json })
              } catch {
                resolve({ success: true, status: res.statusCode, data, raw: true })
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
    async (_event: Electron.IpcMainInvokeEvent, url: string, referer?: string) => {
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
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': referer || `${urlObj.protocol}//${urlObj.hostname}/`,
              'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
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
              resolve({ success: true, data: `data:${contentType};base64,${base64}` })
            })
          })
          req.setTimeout(15000, () => { req.destroy(); resolve({ success: false, error: '超时' }) })
          req.on('error', (err: Error) => resolve({ success: false, error: err.message }))
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
  const bdPath = join(__dirname, '../../bd')
  const goExe = join(bdPath, 'backend', process.platform === 'win32' ? 'main.exe' : 'main')
  let goProc: ReturnType<typeof spawn> | null = null

  if (fsSync.existsSync(goExe)) {
    goProc = spawn(goExe, [], { cwd: join(bdPath, 'backend') })
    goProc.stdout?.on('data', (d: Buffer) => console.log('[Go]', d.toString().trim()))
    goProc.stderr?.on('data', (d: Buffer) => console.error('[Go]', d.toString().trim()))
    goProc.on('exit', (code) => console.log('[Go] exited with code', code))
  } else {
    console.warn('[Go] backend exe not found:', goExe)
  }

  app.on('will-quit', () => {
    goProc?.kill()
  })

  // ── Python 刮削 / 下载 ──────────────────────────────────

  ipcMain.handle('scraper:scrape', async (_, avid: string) => {
    return new Promise((resolve) => {
      const proc = spawn('python', ['tools/scrape.py', avid], {
        cwd: bdPath,
        env: { ...process.env },
      })
      let out = ''
      let err = ''
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
      proc.on('close', () => {
        try {
          const lines = out.trim().split('\n')
          const jsonLine = lines.filter((l) => l.startsWith('{')).pop() || ''
          const parsed = JSON.parse(jsonLine)
          parsed._log = err  // 把 stderr 带回去方便前端显示
          resolve(parsed)
        } catch {
          resolve({ error: 'parse failed', _log: err + '\n' + out })
        }
      })
    })
  })

  ipcMain.handle('scraper:fetchMeta', async (_, avid: string) => {
    return new Promise((resolve) => {
      const proc = spawn('python', ['tools/fetch_meta.py', avid], {
        cwd: bdPath,
        env: { ...process.env },
      })
      let out = ''
      let err = ''
      proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
      proc.on('close', (_code: number) => {
        try {
          // stdout 最后一行才是 JSON，前面可能有 loguru 日志
          const lines = out.trim().split('\n')
          const jsonLine = lines.filter((l) => l.startsWith('{')).pop() || ''
          resolve(JSON.parse(jsonLine))
        } catch {
          resolve({ error: err || 'parse failed', raw: out })
        }
      })
    })
  })

  const downloaderProcs = new Map<string, ChildProcess>()

  ipcMain.on('downloader:start', (event, avid: string) => {
    if (downloaderProcs.has(avid)) {
      event.sender.send('downloader:log', { avid, text: '[already running]' })
      return
    }
    const proc = spawn('python', ['main.py', avid], {
      cwd: bdPath,
      env: { ...process.env },
    })
    downloaderProcs.set(avid, proc)
    proc.stdout.on('data', (d: Buffer) =>
      event.sender.send('downloader:log', { avid, text: d.toString() })
    )
    proc.stderr.on('data', (d: Buffer) =>
      event.sender.send('downloader:log', { avid, text: d.toString() })
    )
    proc.on('close', (code: number) => {
      downloaderProcs.delete(avid)
      event.sender.send('downloader:done', { avid, code })
    })
  })

  ipcMain.on('downloader:cancel', (_, avid: string) => {
    const proc = downloaderProcs.get(avid)
    if (proc) {
      proc.kill()
      downloaderProcs.delete(avid)
    }
  })

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

    detailWin = new BrowserWindow({
      width: 1100,
      height: 800,
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
      detailWin.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/online-detail')
      detailWin.webContents.openDevTools()
    } else {
      detailWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/online-detail' })
    }
    return { success: true }
  })

  ipcMain.handle('detail:getData', () => pendingDetailData)

  ipcMain.handle('player:open', async (_, filePath: string) => {
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/')
    const title = path.basename(filePath)
    const playerHtml = join(__dirname, '../../resources/player.html')
    const playerPreload = join(__dirname, '../../resources/player-preload.js')
    const win = new BrowserWindow({
      width: 1280,
      height: 760,
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
    const onMin = (_e: Electron.IpcMainEvent) => { if (_e.sender === win.webContents) win.minimize() }
    const onClose = (_e: Electron.IpcMainEvent) => { if (_e.sender === win.webContents) win.close() }
    ipcMain.on('player-win:minimize', onMin)
    ipcMain.on('player-win:close', onClose)
    win.on('closed', () => {
      ipcMain.off('player-win:minimize', onMin)
      ipcMain.off('player-win:close', onClose)
    })
    const query = '?src=' + encodeURIComponent(fileUrl) + '&title=' + encodeURIComponent(title)
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
