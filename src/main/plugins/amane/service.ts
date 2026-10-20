/**
 * Amane 托管进程的生命周期：健康检查 → 启动（打包后台 / 开发源码）→ 意外退出自动重启 → 停止。
 *
 * 外部服务模式只做健康检查，不起进程。
 */
import { app } from 'electron'
import { type ChildProcess, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { dirname } from 'path'
import { createServer } from 'net'
import type { AmaneStatus } from '../../../shared/amane'
import { pluginLogger } from '../host'
import { relayLines, stopProcess } from '../process'
import {
  connection,
  fetchApi,
  persist,
  publicSettings,
  resolveSourceRuntime,
} from './connection'
import {
  AMANE_VERSION,
  RESTART_EXHAUSTED,
  executableProblem,
  restartPlan,
  serviceEnv,
  sourceEnv,
} from './rules'

const sleep = (ms: number): Promise<void> =>
  new Promise(done => setTimeout(done, ms))
const log = pluginLogger('Amane')

/** 托管进程与对外状态 */
export const service = {
  child: null as ChildProcess | null,
  state: 'stopped' as AmaneStatus['state'],
  failure: '',
  version: undefined as string | undefined,
  starting: null as Promise<AmaneStatus> | null,
  quitting: false,
  restartAttempts: 0,
  restartTimer: null as NodeJS.Timeout | null,
}

/** 当前状态快照 */
export const snapshot = (): AmaneStatus => ({
  state: service.state,
  owned: Boolean(service.child),
  version: service.version,
  error: service.failure || undefined,
  settings: publicSettings(),
})

function scheduleRestart(): void {
  const { settings } = connection
  if (
    service.quitting ||
    settings.mode !== 'managed' ||
    !settings.executablePath
  )
    return
  const plan = restartPlan(service.restartAttempts)
  if (!plan) {
    service.state = 'error'
    service.failure = RESTART_EXHAUSTED
    return
  }
  service.restartAttempts = plan.attempt
  service.state = 'starting'
  service.failure = plan.message
  service.restartTimer?.unref()
  service.restartTimer = setTimeout(() => {
    if (service.quitting || service.child) return
    void startService()
      .then(snap => {
        if (snap.state === 'error' && restartPlan(service.restartAttempts))
          scheduleRestart()
      })
      .catch(() => {})
  }, plan.delay)
}

/** 健康检查：版本匹配 + 令牌可用 */
export async function checkHealth(): Promise<void> {
  const response = await fetchApi('/api/health', {
    signal: AbortSignal.timeout(1500),
  })
  if (!response.ok)
    throw new Error(`Amane 健康检查失败（HTTP ${response.status}）`)
  const health = (await response.json()) as {
    status?: string
    version?: string
  }
  if (health.status !== 'ok' || health.version !== AMANE_VERSION)
    throw new Error(
      `需要 Amane ${AMANE_VERSION}，当前服务版本为 ${health.version || '未知'}`
    )
  const auth = await fetchApi('/api/libraries', {
    signal: AbortSignal.timeout(2000),
  })
  if (auth.status === 401 || auth.status === 403)
    throw new Error('Amane API Token 不正确，请在连接设置中更新')
  if (!auth.ok) throw new Error(`Amane 服务尚未就绪（HTTP ${auth.status}）`)
  service.version = health.version
}

async function requireFreePort(): Promise<void> {
  const url = new URL(connection.settings.baseUrl)
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

/** 健康检查通过：标记运行中并清零重启计数 */
async function becomeRunning(): Promise<AmaneStatus> {
  await checkHealth()
  service.state = 'running'
  service.restartAttempts = 0
  return snapshot()
}

/** 起托管进程并等它健康（最多 45 秒） */
async function launch(): Promise<AmaneStatus> {
  const { settings } = connection
  const source = settings.mode === 'managed' ? resolveSourceRuntime() : null
  if (source) log.info('开发模式:运行项目源码', source.sourceDir)
  if (!source) {
    const problem = executableProblem(settings.executablePath, existsSync)
    if (problem) throw new Error(problem)
  }
  if (!connection.token) {
    connection.token = randomBytes(32).toString('hex')
    await persist()
  }
  await fs.mkdir(settings.dataDirectory, { recursive: true })
  if (service.quitting) throw new Error('影盒正在退出')
  const amaneEnv = serviceEnv(settings, connection.token, process.env)
  const command = source
    ? {
        bin: source.python,
        args: source.args,
        cwd: source.cwd,
        env: sourceEnv(amaneEnv, source.sourceDir, process.env.PYTHONPATH),
      }
    : {
        bin: settings.executablePath,
        args: [] as string[],
        cwd: dirname(settings.executablePath),
        env: amaneEnv,
      }
  const child = spawn(command.bin, command.args, {
    cwd: command.cwd,
    shell: false,
    windowsHide: true,
    env: command.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // 开发时把 Amane.Server 输出转到主进程控制台；打包版只读空管道
  const relay = (channel: string): ((line: string) => void) | null =>
    app.isPackaged ? null : (line: string) => log.info(`${channel}:`, line)
  relayLines(child.stdout, relay('out'))
  relayLines(child.stderr, relay('err'))
  service.child = child
  child.once('error', error => {
    if (service.child === child) {
      service.child = null
      service.state = 'error'
      service.failure = `Amane 后台启动失败：${error.message}`
    }
  })
  child.once('exit', () => {
    if (service.child === child) {
      service.child = null
      scheduleRestart()
    }
  })
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (service.child !== child)
      throw new Error(service.failure || 'Amane 后台已停止')
    try {
      return await becomeRunning()
    } catch (error) {
      if (Date.now() >= deadline) throw error
    }
    await sleep(500)
  }
  throw new Error('Amane 后台启动超时')
}

/** 启动（并发调用共享同一次启动）；失败时返回 error 状态而不是抛错 */
export async function startService(): Promise<AmaneStatus> {
  if (service.quitting) return snapshot()
  if (
    service.state === 'error' &&
    service.failure.startsWith('Amane 连接设置无法读取')
  )
    return snapshot()
  if (service.starting) return service.starting
  service.starting = (async () => {
    service.failure = ''
    service.state = 'starting'
    try {
      if (service.child || connection.settings.mode === 'external')
        return await becomeRunning()
      try {
        await requireFreePort()
      } catch (portError) {
        // 端口被占用时,可能是刚被强杀的旧实例仍在 TIME_WAIT,或已有健康实例:允许接管
        try {
          return await becomeRunning()
        } catch {
          throw portError
        }
      }
      return await launch()
    } catch (error) {
      service.state = 'error'
      service.failure =
        error instanceof Error ? error.message : 'Amane 启动失败'
      if (service.child) await stopChild()
      log.error(service.failure)
      return snapshot()
    }
  })().finally(() => {
    service.starting = null
  })
  return service.starting
}

/** 停掉托管进程（没有就直接返回） */
export async function stopChild(): Promise<void> {
  const child = service.child
  if (!child) return
  service.child = null
  await stopProcess(child)
}

/** 退出：不再自动重启，等正在进行的启动结束后停掉托管进程（外部服务不动） */
export async function shutdown(): Promise<void> {
  service.quitting = true
  if (service.restartTimer) {
    clearTimeout(service.restartTimer)
    service.restartTimer = null
  }
  if (service.starting) await service.starting
  await stopChild()
}
