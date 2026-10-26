/**
 * 网盘类模块（pan115、追更、洗版、电影追踪、库外发现）的宿主接口：模块入口只依赖它，不依赖 Electron。
 *
 * 两个宿主各给一份实现：
 * - 桌面端（desktop.ts）：契约走 ipcMain、事件广播给窗口、设置读 settings.json、数据在 userData；
 * - 独立服务（src/server/netdisk）：契约走 HTTP RPC / SSE、设置读服务端设置文件、定时器只在持有租约的实例上跑。
 */
import type {
  ArgsOf,
  Domain,
  PayloadOf,
  ResultOf,
  SyncCall,
} from '../../shared/contract/define'
import type { SettingValue, ValueKey } from '../../shared/settings/schema'

/** 一个域的全部处理函数（与 rpc/index.ts 的 Handlers 同形；第一个参数是宿主的调用上下文，模块不读它） */
export type DomainHandlers<D extends Domain> = {
  [K in keyof D['calls']]: (
    ctx: unknown,
    ...args: ArgsOf<D['calls'][K]>
  ) => D['calls'][K] extends SyncCall<infer _A, infer R>
    ? R
    : ResultOf<D['calls'][K]> | Promise<ResultOf<D['calls'][K]>>
}

/** 一个定时任务：启动 firstDelayMs 后跑第一轮，之后每 intervalMs 一轮 */
export interface ScheduledTask {
  /** 日志与单例判定用的名字 */
  name: string
  firstDelayMs: number
  intervalMs: number
  run(): void
}

/** 模块宿主 */
export interface ModuleHost {
  /** 模块状态文件所在目录（桌面端 userData，服务端数据目录） */
  dataDir: string
  /** 读一个设置（服务端只认网盘相关的几个键，其余为默认值） */
  setting<K extends ValueKey>(key: K): SettingValue<K>
  /** 当前生效的 TMDB 令牌（用户填的优先，环境变量兜底）；没有时为空串 */
  tmdbToken(): string
  /** 按契约登记一个域的处理函数 */
  implement<D extends Domain>(domain: D, handlers: DomainHandlers<D>): void
  /** 推送契约里声明的事件 */
  emit<D extends Domain, K extends keyof D['events'] & string>(
    domain: D,
    event: K,
    payload: PayloadOf<D['events'][K]>
  ): void
  /** 登记定时任务（服务端只在持有调度租约的实例上真正执行） */
  schedule(task: ScheduledTask): void
}

/** 进程内的普通定时：setTimeout 后 setInterval，都 unref，不拖住进程退出 */
export function intervalSchedule(task: ScheduledTask): void {
  setTimeout(() => {
    task.run()
    setInterval(task.run, task.intervalMs).unref()
  }, task.firstDelayMs).unref()
}
