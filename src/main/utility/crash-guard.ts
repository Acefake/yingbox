/**
 * 后台进程崩溃守卫：决定 utilityProcess 意外退出后还能不能再 fork，并给出看得懂的原因。
 *
 * 为什么需要：UtilityHost 在子进程崩溃后「下一次调用就重启」。启动即崩时（最常见的是拉了新代码
 * 没跑 pnpm install，子进程 import 不到新依赖），渲染层启动时的每一次调用都会 fork 一个新的
 * Electron 子进程、几百毫秒后又崩掉；在线页、海报墙、设置同时发请求时就是一场 fork 风暴，
 * Windows 上能把整机拖死、窗口一直白屏。
 *
 * 两种情况停止重启（直到应用重启）：
 * - 缺依赖：stderr 里出现 Cannot find module / Cannot find package（npm 包名，不含相对路径），
 *   重启多少次结果都一样；
 * - 连续秒退：启动后 QUICK_EXIT_MS 内退出、连续 MAX_QUICK_EXITS 次。
 * 运行一段时间后才退出的属于偶发崩溃，计数清零，照旧在下一次调用时重启。
 */

/** 启动后多久之内退出算「秒退」。 */
export const QUICK_EXIT_MS = 5_000
/** 连续秒退几次后停止重启。 */
export const MAX_QUICK_EXITS = 3

const MISSING_MODULE =
  /Cannot find (?:module|package) '((?:@[^/'\s]+\/)?[^/'\s]+)[^']*'/

/**
 * 从子进程 stderr 里找出缺失的 npm 包名（子路径只留包名：opencc-js/t2cn → opencc-js）。
 * 相对路径、绝对路径（含 Windows 盘符）是构建产物不完整，不算缺依赖。
 */
export function missingPackageIn(text: string): string | undefined {
  const name = MISSING_MODULE.exec(text)?.[1]
  if (!name || name.startsWith('.') || /^[A-Za-z]:|^\//.test(name)) return
  return name
}

/** 一个后台进程的启停记录。 */
export class CrashGuard {
  private quickExits = 0
  private missing: string | undefined
  private startedAt = 0
  /** stderr 可能分块到达，跨块拼接后再匹配（只留尾部，防止无限增长）。 */
  private tail = ''

  constructor(
    /** 进程的中文名，写进原因里（如「媒体库引擎」）。 */
    private readonly name: string,
    private readonly now: () => number = Date.now
  ) {}

  /** 新进程 fork 时调用；at 为 fork 时刻（宿主已取过时钟时传进来）。 */
  started(at: number = this.now()): void {
    this.startedAt = at
    this.tail = ''
  }

  /** 喂给它子进程的 stderr 片段。 */
  observe(chunk: string): void {
    if (this.missing) return
    this.tail = (this.tail + chunk).slice(-4096)
    this.missing = missingPackageIn(this.tail)
  }

  /** 进程意外退出时调用（主动关停不算）。 */
  exited(): void {
    const quick = this.now() - this.startedAt < QUICK_EXIT_MS
    this.quickExits = quick ? this.quickExits + 1 : 0
  }

  /** 不应再 fork 时给出原因，否则 undefined。 */
  blocked(): string | undefined {
    if (this.missing) {
      return `${this.name}缺少依赖 ${this.missing}：请在项目目录运行 pnpm install 后重启应用`
    }
    if (this.quickExits >= MAX_QUICK_EXITS) {
      return `${this.name}连续 ${this.quickExits} 次启动即退出，已停止重启；请查看终端日志后重启应用`
    }
    return undefined
  }
}
