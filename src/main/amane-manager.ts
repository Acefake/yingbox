import { app, dialog, ipcMain, protocol, safeStorage } from 'electron'
import { type ChildProcess, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import {
  dirname,
  isAbsolute,
  join,
  delimiter as pathDelimiter,
  resolve,
} from 'path'
import { createServer } from 'net'
import type { AmaneRequest, AmaneSettings, AmaneStatus } from '../shared/amane'

const VERSION = '0.20.1'
const sleep = (ms: number): Promise<void> =>
  new Promise(done => setTimeout(done, ms))
type SavedSettings = Omit<AmaneSettings, 'tokenConfigured' | 'devSource'> & {
  encryptedToken?: string
}
let settings: SavedSettings
let token = ''
let child: ChildProcess | null = null
let state: AmaneStatus['state'] = 'stopped'
let failure = ''
let version: string | undefined
let starting: Promise<AmaneStatus> | null = null
let quitting = false
let restartAttempts = 0
let restartTimer: NodeJS.Timeout | null = null
const MAX_RESTART_ATTEMPTS = 5

function scheduleRestart(): void {
  if (quitting || settings.mode !== 'managed' || !settings.executablePath)
    return
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    state = 'error'
    failure = `Amane 后台已退出（自动重启 ${MAX_RESTART_ATTEMPTS} 次未成功），请检查数据目录中的 logs`
    return
  }
  restartAttempts += 1
  const delay = Math.min(60000, 4000 * restartAttempts)
  state = 'starting'
  failure = `Amane 后台意外退出，${Math.round(delay / 1000)} 秒后自动重启（第 ${restartAttempts}/${MAX_RESTART_ATTEMPTS} 次）`
  restartTimer?.unref()
  restartTimer = setTimeout(() => {
    if (quitting || child) return
    void startService()
      .then(snap => {
        if (snap.state === 'error' && restartAttempts < MAX_RESTART_ATTEMPTS)
          scheduleRestart()
      })
      .catch(() => {})
  }, delay)
}

function terminateOwned(service: ChildProcess): void {
  if (process.platform === 'win32' && service.pid) {
    const killer = spawn(
      'taskkill',
      ['/pid', String(service.pid), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore' }
    )
    killer.once('error', () => service.kill())
  } else service.kill()
}

const configPath = (): string =>
  join(app.getPath('userData'), 'amane', 'connection.json')
const publicSettings = (): AmaneSettings => ({
  mode: settings.mode,
  executablePath: settings.executablePath,
  baseUrl: settings.baseUrl,
  dataDirectory: settings.dataDirectory,
  tokenConfigured: Boolean(token),
  devSource: Boolean(resolveSourceRuntime()),
})
const snapshot = (): AmaneStatus => ({
  state,
  owned: Boolean(child),
  version,
  error: failure || undefined,
  settings: publicSettings(),
})

function baseUrl(raw: string): string {
  const url = new URL(raw)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Amane 服务地址须为本机 HTTP 地址，例如 http://127.0.0.1:18180'
    )
  }
  return url.origin
}

async function persist(): Promise<void> {
  if (token) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('系统密钥存储不可用，无法安全保存 Amane 连接信息')
    settings.encryptedToken = safeStorage
      .encryptString(token)
      .toString('base64')
  } else delete settings.encryptedToken
  await fs.mkdir(dirname(configPath()), { recursive: true })
  const temp = `${configPath()}.tmp`
  await fs.writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 })
  await fs.rename(temp, configPath())
}

async function initialize(): Promise<void> {
  const executable =
    process.platform === 'win32' ? 'Amane.Server.exe' : 'Amane.Server'
  const candidates = [
    process.env.YINGBOX_AMANE_EXECUTABLE,
    join(process.resourcesPath, 'amane', 'onedir', executable),
    join(app.getAppPath(), 'resources', 'amane', 'onedir', executable),
    join(app.getPath('desktop'), 'Amane', 'onedir', executable),
  ]
  settings = {
    mode: 'managed',
    executablePath: candidates.find(p => p && existsSync(p)) || '',
    baseUrl: 'http://127.0.0.1:18180',
    dataDirectory: join(app.getPath('userData'), 'amane', 'data'),
  }
  try {
    const saved = JSON.parse(
      await fs.readFile(configPath(), 'utf8')
    ) as SavedSettings
    if (
      !saved ||
      !['managed', 'external'].includes(saved.mode) ||
      typeof saved.executablePath !== 'string' ||
      typeof saved.baseUrl !== 'string' ||
      typeof saved.dataDirectory !== 'string' ||
      !isAbsolute(saved.dataDirectory) ||
      (saved.encryptedToken !== undefined &&
        typeof saved.encryptedToken !== 'string')
    ) {
      throw new Error('无效的 Amane 连接设置')
    }
    const savedBase = baseUrl(saved.baseUrl)
    const savedToken = saved.encryptedToken
      ? safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'))
      : ''
    settings = {
      mode: saved.mode,
      executablePath: saved.executablePath,
      baseUrl: savedBase,
      dataDirectory: saved.dataDirectory,
      encryptedToken: saved.encryptedToken,
    }
    token = savedToken
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      state = 'error'
      failure = 'Amane 连接设置无法读取，请在连接设置中重新保存密钥'
    }
  }
}

async function fetchApi(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl(settings.baseUrl)}${path}`, {
    ...init,
    redirect: 'error',
    signal: init.signal || AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
}

async function checkHealth(): Promise<void> {
  const response = await fetchApi('/api/health', {
    signal: AbortSignal.timeout(1500),
  })
  if (!response.ok)
    throw new Error(`Amane 健康检查失败（HTTP ${response.status}）`)
  const health = (await response.json()) as {
    status?: string
    version?: string
  }
  if (health.status !== 'ok' || health.version !== VERSION)
    throw new Error(
      `需要 Amane ${VERSION}，当前服务版本为 ${health.version || '未知'}`
    )
  const auth = await fetchApi('/api/libraries', {
    signal: AbortSignal.timeout(2000),
  })
  if (auth.status === 401 || auth.status === 403)
    throw new Error('Amane API Token 不正确，请在连接设置中更新')
  if (!auth.ok) throw new Error(`Amane 服务尚未就绪（HTTP ${auth.status}）`)
  version = health.version
}

async function requireFreePort(): Promise<void> {
  const url = new URL(settings.baseUrl)
  await new Promise<void>((done, reject) => {
    const probe = createServer()
    probe.once('error', () =>
      reject(
        new Error('Amane 端口已被占用，请修改服务地址，或使用已有服务模式')
      )
    )
    probe.listen(
      Number(url.port || 80),
      url.hostname.replace(/^\[|\]$/g, ''),
      () => probe.close(error => (error ? reject(error) : done()))
    )
  })
}

/** 开发模式直接运行项目内 Amane Python 源码(editable 安装,改即生效);发布版仍用打包后台。
 *  YINGBOX_AMANE_FORCE_EXE=1 可强制回到 exe;YINGBOX_AMANE_SOURCE_DIR 可指定源码目录。 */
function resolveSourceRuntime(): {
  python: string
  args: string[]
  cwd: string
  sourceDir: string
} | null {
  if (app.isPackaged || process.env.YINGBOX_AMANE_FORCE_EXE === '1') return null
  const root =
    process.env.YINGBOX_AMANE_SOURCE_DIR?.trim() ||
    join(app.getAppPath(), 'packages', 'amane', 'upstream')
  const python =
    process.platform === 'win32'
      ? join(root, '.venv', 'Scripts', 'python.exe')
      : join(root, '.venv', 'bin', 'python')
  if (
    !existsSync(python) ||
    !existsSync(join(root, 'src', 'amane', 'server.py'))
  )
    return null
  return {
    python,
    args: ['-c', 'from amane.server import main; main()'],
    cwd: root,
    sourceDir: root,
  }
}

async function startService(): Promise<AmaneStatus> {
  if (quitting) return snapshot()
  if (state === 'error' && failure.startsWith('Amane 连接设置无法读取'))
    return snapshot()
  if (starting) return starting
  starting = (async () => {
    failure = ''
    state = 'starting'
    try {
      if (child) {
        await checkHealth()
        state = 'running'
        restartAttempts = 0
        return snapshot()
      }
      if (settings.mode === 'external') {
        await checkHealth()
        state = 'running'
        restartAttempts = 0
        return snapshot()
      }
      try {
        await requireFreePort()
      } catch (portError) {
        // 端口被占用时,可能是刚被强杀的旧实例仍在 TIME_WAIT,或已有健康实例:允许接管
        try {
          await checkHealth()
          state = 'running'
          restartAttempts = 0
          return snapshot()
        } catch {
          throw portError
        }
      }
      const source = settings.mode === 'managed' ? resolveSourceRuntime() : null
      if (source) console.log('[Amane] 开发模式:运行项目源码', source.sourceDir)
      if (!source) {
        if (
          !settings.executablePath ||
          !isAbsolute(settings.executablePath) ||
          !existsSync(settings.executablePath)
        ) {
          throw new Error(
            '未找到 Amane 后台，请选择 Amane.Server.exe（位于完整安装目录的 onedir 中）'
          )
        }
        if (
          !/^Amane\.Server(?:\.exe)?$/i.test(
            settings.executablePath.split(/[\\/]/).pop() || ''
          )
        )
          throw new Error(
            '请选择 Amane.Server 后台程序，而不是托盘程序 Amane.exe'
          )
      }
      if (!token) {
        token = randomBytes(32).toString('hex')
        await persist()
      }
      await fs.mkdir(settings.dataDirectory, { recursive: true })
      if (quitting) throw new Error('影盒正在退出')
      const url = new URL(settings.baseUrl)
      const amaneEnv: NodeJS.ProcessEnv = {
        ...process.env,
        AMANE_HOST: url.hostname.replace(/^\[|\]$/g, ''),
        AMANE_PORT: url.port || '80',
        AMANE_DATA_DIR: settings.dataDirectory,
        AMANE_LOG_DIR: join(settings.dataDirectory, 'logs'),
        AMANE_TOKEN: token,
        AMANE_SUPERVISED: '1',
        AMANE_UI_DISABLED: '1',
        AMANE_SAFE_DIRS: 'ALLOW_ALL',
        PYDANTIC_DISABLE_PLUGINS: '1',
      }
      const launch = source
        ? {
            command: source.python,
            args: source.args,
            cwd: source.cwd,
            env: {
              ...amaneEnv,
              PYTHONUTF8: '1',
              PYTHONIOENCODING: 'utf-8',
              PYTHONPATH: [
                join(source.sourceDir, 'src'),
                process.env.PYTHONPATH,
              ]
                .filter(Boolean)
                .join(pathDelimiter),
            },
          }
        : {
            command: settings.executablePath,
            args: [] as string[],
            cwd: dirname(settings.executablePath),
            env: amaneEnv,
          }
      const service = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        shell: false,
        windowsHide: true,
        env: launch.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const relayChildLog = (
        stream: NodeJS.ReadableStream | null,
        channel: 'out' | 'err'
      ): void => {
        if (!stream || app.isPackaged) {
          stream?.resume()
          return
        }
        let pending = ''
        stream.on('data', (chunk: Buffer) => {
          pending += chunk.toString('utf8')
          for (;;) {
            const index = pending.indexOf('\n')
            if (index < 0) break
            const line = pending.slice(0, index).trim()
            pending = pending.slice(index + 1)
            if (line)
              console.log(`[Amane.Server:${channel}] ${line.slice(0, 500)}`)
          }
        })
      }
      relayChildLog(service.stdout, 'out')
      relayChildLog(service.stderr, 'err')
      child = service
      service.once('error', error => {
        if (child === service) {
          child = null
          state = 'error'
          failure = `Amane 后台启动失败：${error.message}`
        }
      })
      service.once('exit', () => {
        if (child === service) {
          child = null
          scheduleRestart()
        }
      })
      const deadline = Date.now() + 45000
      while (Date.now() < deadline) {
        if (child !== service) throw new Error(failure || 'Amane 后台已停止')
        try {
          await checkHealth()
          state = 'running'
          restartAttempts = 0
          return snapshot()
        } catch (error) {
          if (Date.now() >= deadline) throw error
        }
        await sleep(500)
      }
      throw new Error('Amane 后台启动超时')
    } catch (error) {
      state = 'error'
      failure = error instanceof Error ? error.message : 'Amane 启动失败'
      if (child) await stopChild()
      console.error('[Amane]', failure)
      return snapshot()
    }
  })().finally(() => {
    starting = null
  })
  return starting
}

async function stopChild(): Promise<void> {
  const service = child
  if (!service) return
  child = null
  const exited = new Promise<void>(done => {
    service.once('exit', () => done())
    setTimeout(done, 3000).unref()
  })
  terminateOwned(service)
  await exited
}

function permitted(request: AmaneRequest): string {
  if (
    !request ||
    typeof request.path !== 'string' ||
    request.path.length > 4096 ||
    !request.path.startsWith('/api/') ||
    /[\\#\r\n]/.test(request.path)
  )
    throw new Error('无效的 Amane 请求')
  const url = new URL(request.path, settings.baseUrl)
  if (url.origin !== new URL(settings.baseUrl).origin)
    throw new Error('无效的 Amane 请求来源')
  const method = request.method || 'GET'
  const routes: Record<string, RegExp> = {
    GET: /^\/api\/(?:agent\/sessions(?:\/\d+(?:\/trace)?)?|saved-queries(?:\/\d+(?:\/result)?)?|health|libraries(?:\/\d+)?|metadata(?:\/\d+)?|media(?:\/\d+)?|actors(?:\/\d+)?|facets\/[a-z_]+|tasks(?:\/(?:\d+|\d+\/children|worker))?|config(?:\/schema)?|network\/sources)$/,
    POST: /^\/api\/(?:agent\/sessions(?:\/\d+\/(?:title|agui(?:\/cancel)?))?|saved-queries(?:\/batch)?|libraries|tasks|tasks\/batch|tasks\/worker\/(?:pause|resume)|metadata\/batch\/(?:scrape|user-tags)|facets\/user_tag|actors\/\d+\/scrape|network\/check)$/,
    DELETE: /^\/api\/agent\/sessions\/\d+$/,
    PATCH:
      /^\/api\/(?:agent\/sessions\/\d+|saved-queries\/\d+|config|libraries\/\d+|metadata\/\d+|media\/\d+)$/,
  }
  if (!routes[method]?.test(url.pathname))
    throw new Error('不支持的 Amane 操作')
  return `${url.pathname}${url.search}`
}

async function requestApi(request: AmaneRequest): Promise<unknown> {
  const path = permitted(request)
  const body =
    request.body === undefined ? undefined : JSON.stringify(request.body)
  if (body && Buffer.byteLength(body) > 1024 * 1024)
    throw new Error('请求内容过大')
  const response = await fetchApi(path, {
    method: request.method || 'GET',
    body,
    signal: AbortSignal.timeout(path === '/api/network/check' ? 120000 : 30000),
  })
  if (Number(response.headers.get('content-length') || 0) > 16 * 1024 * 1024)
    throw new Error('Amane 响应过大，请缩小查询范围')
  if (response.ok && /^\/api\/agent\/sessions\/\d+\/agui$/.test(path)) {
    // Turns run independently of the subscription; the Vue client follows durable trace rows.
    await response.body?.cancel()
    return { accepted: true }
  }
  if (response.status === 204) return null
  const data = (await response.json()) as { detail?: unknown }
  if (!response.ok) {
    const detail =
      typeof data.detail === 'string'
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map(item => (typeof item?.msg === 'string' ? item.msg : ''))
              .filter(Boolean)
              .join('；')
          : ''
    throw new Error(detail || `Amane 请求失败（HTTP ${response.status}）`)
  }
  return data
}

async function imageResponse(request: Request): Promise<Response> {
  try {
    const path = new URL(request.url).searchParams.get('path') || ''
    if (!/^\/api\/resources\/(?:[a-f0-9]{16}|proxy)(?:\?|$)/.test(path))
      return new Response(null, { status: 400 })
    const response = await fetchApi(path)
    if (!response.ok) return new Response(null, { status: response.status })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/'))
      return new Response(null, { status: 415 })
    const reader = response.body?.getReader()
    if (!reader) return new Response(null, { status: 502 })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16 * 1024 * 1024) {
        await reader.cancel()
        return new Response(null, { status: 413 })
      }
      chunks.push(value)
    }
    return new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}

export async function registerAmaneIpc(): Promise<void> {
  await initialize()
  protocol.handle('amane', imageResponse)
  ipcMain.handle('amane:status', async () => {
    if (state === 'running') {
      try {
        await checkHealth()
      } catch (error) {
        state = 'error'
        failure = (error as Error).message
      }
    }
    return snapshot()
  })
  ipcMain.handle('amane:start', () => startService())
  ipcMain.handle('amane:stop', async () => {
    if (starting) await starting
    await stopChild()
    state = 'stopped'
    failure = ''
    return snapshot()
  })
  ipcMain.handle(
    'amane:configure',
    async (_event, changes: Partial<AmaneSettings> & { token?: string }) => {
      if (starting || child)
        throw new Error('请先停止由影盒管理的 Amane 后台，再修改连接设置')
      if (
        !changes ||
        !['managed', 'external'].includes(changes.mode || settings.mode)
      )
        throw new Error('无效的服务模式')
      const next = { ...settings }
      if (changes.mode) next.mode = changes.mode
      if (changes.baseUrl !== undefined) next.baseUrl = baseUrl(changes.baseUrl)
      if (changes.executablePath !== undefined)
        next.executablePath = String(changes.executablePath).trim()
      if (changes.dataDirectory !== undefined) {
        if (!isAbsolute(changes.dataDirectory))
          throw new Error('数据目录须为绝对路径')
        next.dataDirectory = resolve(changes.dataDirectory)
      }
      if (
        changes.token !== undefined &&
        (typeof changes.token !== 'string' ||
          changes.token.length > 4096 ||
          /[\r\n]/.test(changes.token))
      )
        throw new Error('无效的 API Token')
      const previous = settings
      const previousToken = token
      settings = next
      if (changes.token !== undefined) token = changes.token.trim()
      try {
        await persist()
      } catch (error) {
        settings = previous
        token = previousToken
        throw error
      }
      state = 'stopped'
      failure = ''
      version = undefined
      return snapshot()
    }
  )
  ipcMain.handle('amane:selectExecutable', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Amane 后台程序',
      properties: ['openFile'],
      filters: [
        {
          name: 'Amane.Server',
          extensions: process.platform === 'win32' ? ['exe'] : ['*'],
        },
      ],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('amane:request', (_event, request: AmaneRequest) =>
    requestApi(request)
  )
  // 手机接入:把当前服务的 baseUrl + token 交给渲染层,由"手机访问"面板生成接入链接。
  ipcMain.handle('amane:connectionInfo', () => ({
    baseUrl: settings.baseUrl,
    token: token || '',
  }))
  // 仅解析路径，不直接开播放窗：播放引擎（内置 / mpv）由渲染层统一决定。
  ipcMain.handle('amane:resolveMedia', async (_event, mediaId: number) => {
    try {
      const filePath = await resolveAmaneMedia(mediaId)
      return { success: true, filePath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
  app.on('before-quit', () => {
    quitting = true
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    const service = child
    child = null
    if (service) terminateOwned(service)
  })
}

/** Playback paths are resolved from indexed media, never supplied as arbitrary IPC arguments. */
async function resolveAmaneMedia(mediaId: number): Promise<string> {
  if (!Number.isSafeInteger(mediaId) || mediaId < 1)
    throw new Error('无效的媒体文件')
  const media = (await requestApi({ path: `/api/media/${mediaId}` })) as {
    path: string
    library_id: number
  }
  const library = (await requestApi({
    path: `/api/libraries/${media.library_id}`,
  })) as { path: string }
  const path = isAbsolute(media.path)
    ? media.path
    : resolve(library.path, media.path)
  const stat = await fs.stat(path)
  if (!stat.isFile()) throw new Error('关联的视频文件不存在')
  return path
}
