/**
 * 插件宿主：Amane / Lada / mpv 这类「主进程托管的外部程序」统一登记在这里。
 *
 * - 启动：各插件都只在第一次被用到时启动（Amane 进入片库页、lada 开始任务、
 *   mpv 打开文件）；参数各不相同，所以 start 仍由各插件自己实现。
 * - 停止 / 健康 / 日志：统一接口，日志统一加 `[插件名]` 前缀。
 * - 退出清理：应用退出时宿主先拦住退出，并行停掉所有插件（每个最多等 STOP_TIMEOUT_MS），
 *   全部结束后再放行。原先三处各自 `app.on('before-quit')` 只发信号不等退出，
 *   进程可能在影盒退出后残留。
 */

/** 插件当前状态。 */
export interface PluginHealth {
  /** 是否有影盒托管的进程 / 会话在运行；为 false 时退出清理会跳过该插件 */
  running: boolean
  /** 给人看的一句话状态 */
  detail?: string
}

/** 插件向宿主登记的能力。 */
export interface Plugin {
  /** 唯一名，也是日志前缀 */
  id: string
  /** 停止插件；没在运行时应直接返回 */
  stop(): Promise<void> | void
  /** 当前状态 */
  health(): PluginHealth
}

/** 插件日志：统一前缀，避免各处手写 `[Amane]`、`[lada]`。 */
export interface PluginLogger {
  info(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** 单个插件停止的最长等待；超时不再等，放行退出。 */
export const STOP_TIMEOUT_MS = 5000

const plugins = new Map<string, Plugin>()

/** 登记插件；同名重复登记会替换旧的（便于测试与热重载）。 */
export function registerPlugin(plugin: Plugin): Plugin {
  plugins.set(plugin.id, plugin)
  return plugin
}

/** 取消登记（测试用）。 */
export function unregisterPlugin(id: string): void {
  plugins.delete(id)
}

/** 返回带统一前缀的日志器。 */
export function pluginLogger(id: string): PluginLogger {
  const prefix = `[${id}]`
  return {
    info: (...args) => console.log(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  }
}

/** 所有已登记插件的状态快照；某个 health 抛错时记为未运行并带上错误信息。 */
export function pluginHealth(): Record<string, PluginHealth> {
  const result: Record<string, PluginHealth> = {}
  for (const [id, plugin] of plugins) {
    try {
      result[id] = plugin.health()
    } catch (error) {
      result[id] = { running: false, detail: (error as Error).message }
    }
  }
  return result
}

/**
 * 并行停止所有正在运行的插件（health().running 为 false 的跳过）。
 * 单个插件失败或超时只记日志，不影响其它插件。
 * @returns 停止失败或超时的插件名
 */
export async function stopAllPlugins(
  timeoutMs: number = STOP_TIMEOUT_MS
): Promise<string[]> {
  const failed: string[] = []
  const health = pluginHealth()
  const running = [...plugins.values()].filter(p => health[p.id]?.running)
  await Promise.all(
    running.map(async plugin => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      })
      try {
        const outcome = await Promise.race([
          Promise.resolve(plugin.stop()).then(() => 'ok' as const),
          timeout,
        ])
        if (outcome === 'timeout') {
          failed.push(plugin.id)
          pluginLogger(plugin.id).error(`退出时停止超时（${timeoutMs}ms）`)
        }
      } catch (error) {
        failed.push(plugin.id)
        pluginLogger(plugin.id).error('退出时停止失败：', error)
      } finally {
        clearTimeout(timer)
      }
    })
  )
  return failed
}

/** installPluginHost 需要的最小 app 接口（便于测试注入）。 */
export interface QuitSource {
  on(
    event: 'before-quit',
    listener: (event: { preventDefault(): void }) => void
  ): unknown
  quit(): void
}

/**
 * 接管退出清理：第一次 before-quit 时拦住退出、停掉全部插件，再重新 quit。
 * 第二次 before-quit（宿主自己发起的）直接放行。只应调用一次。
 */
export function installPluginHost(app: QuitSource): void {
  let phase: 'idle' | 'stopping' | 'done' = 'idle'
  app.on('before-quit', event => {
    if (phase === 'done') return
    event.preventDefault()
    if (phase === 'stopping') return
    phase = 'stopping'
    void stopAllPlugins().finally(() => {
      phase = 'done'
      app.quit()
    })
  })
}
