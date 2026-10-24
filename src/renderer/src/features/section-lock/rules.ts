/**
 * 板块密码锁的纯规则：哪些板块可以锁（读路由表）、某个板块此刻要不要解锁、
 * 解锁状态随进入 / 离开板块怎么变。不依赖 Vue / 路由实例，便于测试。
 */

/** 可锁定判断需要的路由信息（vue-router RouteRecordRaw 的子集） */
export interface LockableRoute {
  name?: unknown
  path: string
  redirect?: unknown
  meta?: { title?: unknown; adultOnly?: unknown; lockable?: unknown }
}

/** 设置里可选的一个板块 */
export interface LockableSection {
  /** 路由名（存进设置 lock.sections） */
  name: string
  /** 显示名（路由 meta.title） */
  title: string
  path: string
  adultOnly: boolean
}

/** 首页（启动落地页）不能锁，否则一打开应用就被拦住 */
const HOME_PATH = '/'

/**
 * 可锁定的板块：有名字、有标题、不是重定向和首页的路由；meta.lockable === false 的不列。
 * 成人板块只在成人模式下列出。新加的板块（路由）自动出现在列表里。
 */
export function lockableSections(
  routes: readonly LockableRoute[],
  adultMode: boolean
): LockableSection[] {
  const sections: LockableSection[] = []
  for (const route of routes) {
    const { name, path, meta } = route
    if (typeof name !== 'string' || !name || route.redirect) continue
    if (path === HOME_PATH || path.includes(':')) continue
    if (typeof meta?.title !== 'string' || meta.lockable === false) continue
    const adultOnly = Boolean(meta.adultOnly)
    if (adultOnly && !adultMode) continue
    sections.push({ name, title: meta.title, path, adultOnly })
  }
  return sections
}

/** 本次运行里解锁过的板块：name → 离开时间（还在板块里为 null） */
export type UnlockLedger = Readonly<Record<string, number | null>>

/** 「离开后重新锁定」的选项（分钟；0 = 本次运行内一直有效） */
export const RELOCK_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '不自动锁定（重启应用后锁定）' },
  { value: 1, label: '离开 1 分钟后' },
  { value: 5, label: '离开 5 分钟后' },
  { value: 15, label: '离开 15 分钟后' },
  { value: 30, label: '离开 30 分钟后' },
  { value: 60, label: '离开 1 小时后' },
]

/** 锁是否对这个板块生效：设置里勾了、且已设应用密码 */
export function isLockActive(
  name: string,
  lockedNames: readonly string[],
  passwordSet: boolean
): boolean {
  return passwordSet && lockedNames.includes(name)
}

/** 解锁是否仍有效：解锁过，且还在板块里 / 没设自动锁定 / 离开没超过时限 */
export function isUnlocked(
  ledger: UnlockLedger,
  name: string,
  relockMinutes: number,
  now: number
): boolean {
  if (!(name in ledger)) return false
  const leftAt = ledger[name]
  if (leftAt === null || relockMinutes <= 0) return true
  return now - leftAt < relockMinutes * 60_000
}

/** 进入板块要不要先解锁 */
export function needsUnlock(input: {
  name: string
  lockedNames: readonly string[]
  passwordSet: boolean
  ledger: UnlockLedger
  relockMinutes: number
  now: number
}): boolean {
  const { name, lockedNames, passwordSet, ledger, relockMinutes, now } = input
  return (
    isLockActive(name, lockedNames, passwordSet) &&
    !isUnlocked(ledger, name, relockMinutes, now)
  )
}

/** 解锁成功：记为「在板块里」 */
export function markUnlocked(ledger: UnlockLedger, name: string): UnlockLedger {
  return { ...ledger, [name]: null }
}

/** 回到板块（解锁仍有效时）：清掉离开时间 */
export function markEntered(ledger: UnlockLedger, name: string): UnlockLedger {
  return name in ledger && ledger[name] !== null
    ? { ...ledger, [name]: null }
    : ledger
}

/** 离开板块（切路由 / 窗口隐藏）：记下离开时间，已在计时的不重置 */
export function markLeft(
  ledger: UnlockLedger,
  name: string,
  now: number
): UnlockLedger {
  return name in ledger && ledger[name] === null
    ? { ...ledger, [name]: now }
    : ledger
}

/** 「还要等多久」的提示文字 */
export function retryText(retryAfterMs: number): string {
  const seconds = Math.ceil(retryAfterMs / 1000)
  if (seconds < 60) return `输错次数过多，请 ${seconds} 秒后再试`
  return `输错次数过多，请 ${Math.ceil(seconds / 60)} 分钟后再试`
}
