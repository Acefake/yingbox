/**
 * 引擎崩溃守卫：决定引擎退出后要不要再重启，并给出能看懂的原因。
 *
 * 两种情况不再自动重启（直到应用重启）：
 * - 缺依赖：stderr 里出现 Cannot find module / Cannot find package。多半是拉了新代码没装依赖，
 *   重启多少次都一样，只会刷屏；
 * - 连续秒退：启动后很快退出、连续 MAX_QUICK_EXITS 次。
 * 运行一段时间后才退出的属于偶发崩溃，照旧在下一次调用时重启。
 */

/** 启动后多久之内退出算「秒退」。 */
export const QUICK_EXIT_MS = 5_000
/** 连续秒退几次后放弃。 */
export const MAX_QUICK_EXITS = 3

const MISSING_MODULE =
  /Cannot find (?:module|package) '((?:@[^/'\s]+\/)?[^/'\s]+)[^']*'/

/**
 * 从引擎的 stderr 里找出缺失的 npm 包名（子路径只留包名：opencc-js/t2cn → opencc-js）。
 * 相对路径（./、../）和绝对路径不是缺依赖，是构建产物不完整，不算。
 */
export function missingPackageIn(text: string): string | undefined {
  const name = MISSING_MODULE.exec(text)?.[1]
  if (!name || name.startsWith('.') || /^[A-Za-z]:|^\//.test(name)) return
  return name
}

/** 引擎进程的启停记录。 */
export class CrashGuard {
  private quickExits = 0
  private missing: string | undefined
  private startedAt = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** 新进程启动时调用。 */
  started(): void {
    this.startedAt = this.now()
  }

  /** 喂给它引擎的 stderr 片段。 */
  observe(chunk: string): void {
    this.missing ??= missingPackageIn(chunk)
  }

  /** 进程退出时调用。 */
  exited(): void {
    const quick = this.now() - this.startedAt < QUICK_EXIT_MS
    this.quickExits = quick ? this.quickExits + 1 : 0
  }

  /** 不应再重启时给出原因，否则 undefined。 */
  blocked(): string | undefined {
    if (this.missing) {
      return `媒体库引擎缺少依赖 ${this.missing}：请在项目目录运行 pnpm install，再重新构建并启动`
    }
    if (this.quickExits >= MAX_QUICK_EXITS) {
      return `媒体库引擎连续 ${this.quickExits} 次启动即退出，已停止重启；请查看终端日志后重启应用`
    }
    return undefined
  }
}
