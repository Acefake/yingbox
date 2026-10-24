/**
 * 板块密码锁的运行时状态（全应用一份）：锁的现状（是否设了密码、系统认证、锁哪些板块，读自主进程）、
 * 本次运行的解锁记录、正在等待的验证请求（进入板块解锁，或设置里降低保护前的身份验证）；
 * 以及挂到路由上的守卫与窗口隐藏时的计时。
 *
 * 解锁只存在内存里：重启应用（或刷新渲染层）后重新锁定。
 */
import { shallowRef } from 'vue'
import type { Router } from 'vue-router'

import {
  type LockConfig,
  type SectionLockStatus,
  weakensLock,
} from '../../../../shared/section-lock'
import {
  type UnlockLedger,
  isLockActive,
  isUnlocked,
  markEntered,
  markLeft,
  markUnlocked,
  needsUnlock,
} from './rules'

/**
 * 一个等待验证的请求；SectionLockGate 显示它，结束时 resolve 主进程签发的一次性凭据（取消为空串）。
 * kind 'enter'：进入锁定板块；'authorize'：设置里降低保护前验证身份。
 */
export interface UnlockRequest {
  kind: 'enter' | 'authorize'
  title: string
  /** authorize 时显示的说明 */
  reason?: string
  resolve: (grant: string) => void
}

const bridge =
  typeof window !== 'undefined' ? window.api?.sectionLock : undefined

const status = shallowRef<SectionLockStatus>({
  sections: [],
  relockMinutes: 0,
  passwordSet: false,
  systemAuth: null,
})
const ledger = shallowRef<UnlockLedger>({})
const request = shallowRef<UnlockRequest | null>(null)
/** 粗粒度时钟：侧栏锁图标在「离开 N 分钟」到点后也能刷新 */
const clock = shallowRef(Date.now())
const CLOCK_TICK_MS = 30_000
let loaded: Promise<void> | null = null
/** 路由路径 → 路由名（安装守卫时由路由实例提供） */
let resolveName: (path: string) => string = () => ''

/** 桌面端才有锁（网页端没有主进程保存密码） */
export const sectionLockAvailable = Boolean(bridge)

/** 锁的现状（响应式） */
export function sectionLockStatus(): Readonly<typeof status> {
  return status
}

/** 当前等待验证的请求（响应式） */
export function unlockRequest(): Readonly<typeof request> {
  return request
}

/** 重新读取锁的现状（改密码 / 改配置后调用） */
export async function refreshLockStatus(): Promise<void> {
  if (!bridge) return
  status.value = await bridge.status()
}

function ensureStatus(): Promise<void> {
  loaded ??= refreshLockStatus().catch(() => {})
  return loaded
}

function lockedNames(): string[] {
  return status.value.sections
}

/** 板块此刻是否锁着（侧栏锁图标用；在 computed 里调用是响应式的） */
export function isSectionLocked(name: string): boolean {
  if (!isLockActive(name, lockedNames(), status.value.passwordSet)) return false
  const relock = status.value.relockMinutes
  return !isUnlocked(ledger.value, name, relock, clock.value)
}

/** 按路径判断（侧栏导航项只有路径） */
export function isPathLocked(path: string): boolean {
  const name = resolveName(path)
  return Boolean(name) && isSectionLocked(name)
}

/** 弹出验证界面，返回凭据（取消为空串）；已有请求时先取消它 */
function openRequest(init: Omit<UnlockRequest, 'resolve'>): Promise<string> {
  request.value?.resolve('')
  return new Promise(resolve => {
    const pending: UnlockRequest = {
      ...init,
      resolve: grant => {
        if (request.value === pending) request.value = null
        resolve(grant)
      },
    }
    request.value = pending
  })
}

/** 请求解锁一个板块：解锁成功返回 true */
export async function requestUnlock(
  name: string,
  title: string
): Promise<boolean> {
  const grant = await openRequest({ kind: 'enter', title })
  if (grant) ledger.value = markUnlocked(ledger.value, name)
  return Boolean(grant)
}

/**
 * 降低保护前验证身份（密码或 Touch ID，与进入板块同一个界面）：
 * 返回主进程签发的一次性凭据，取消返回空串。凭据交给对应写入接口，由主进程校验。
 */
export function requestAuthorization(reason: string): Promise<string> {
  return openRequest({ kind: 'authorize', title: '验证身份', reason })
}

/** 一次受保护写入的结果：已写入 / 用户取消验证 / 主进程拒绝（凭据过期等） */
export type GuardedWrite = 'saved' | 'cancelled' | 'rejected'

/**
 * 写入锁的配置：设了密码且降低保护（取消锁定、放宽重新锁定）时先验证身份拿凭据；
 * 主进程会再校验一遍，这里只是先弹验证界面。
 */
export async function saveLockConfig(
  next: LockConfig,
  reason: string
): Promise<GuardedWrite> {
  if (!bridge) return 'rejected'
  const current = status.value
  let grant = ''
  if (current.passwordSet && weakensLock(current, next)) {
    grant = await requestAuthorization(reason)
    if (!grant) return 'cancelled'
  }
  const config = {
    sections: [...next.sections],
    relockMinutes: next.relockMinutes,
  }
  const ok = await bridge.setConfig(config, grant)
  await refreshLockStatus()
  return ok ? 'saved' : 'rejected'
}

async function shouldPrompt(name: string): Promise<boolean> {
  if (!bridge || !name) return false
  await ensureStatus()
  return needsUnlock({
    name,
    lockedNames: lockedNames(),
    passwordSet: status.value.passwordSet,
    ledger: ledger.value,
    relockMinutes: status.value.relockMinutes,
    now: Date.now(),
  })
}

const routeName = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * 挂到路由上：进入锁定板块前要求解锁（取消则留在原页，首次导航回首页）；
 * 切走或窗口隐藏开始计时，回到窗口时若已超时，先回首页再要求解锁。
 */
export function installSectionLockGuard(router: Router): void {
  if (!bridge) return
  resolveName = path => routeName(router.resolve(path).name)
  void ensureStatus()
  window.setInterval(() => {
    clock.value = Date.now()
  }, CLOCK_TICK_MS)

  router.beforeEach(async (to, from) => {
    const name = routeName(to.name)
    if (!(await shouldPrompt(name))) return true
    const title = typeof to.meta?.title === 'string' ? to.meta.title : name
    if (await requestUnlock(name, title)) return true
    return from.matched.length ? false : '/'
  })

  router.afterEach((to, from) => {
    const left = routeName(from.name)
    const entered = routeName(to.name)
    if (left && left !== entered)
      ledger.value = markLeft(ledger.value, left, Date.now())
    if (entered) ledger.value = markEntered(ledger.value, entered)
  })

  document.addEventListener('visibilitychange', () => {
    const current = router.currentRoute.value
    const name = routeName(current.name)
    if (!name) return
    if (document.hidden) {
      ledger.value = markLeft(ledger.value, name, Date.now())
      return
    }
    clock.value = Date.now()
    void shouldPrompt(name).then(async locked => {
      if (!locked) {
        ledger.value = markEntered(ledger.value, name)
        return
      }
      // 内容不留在屏幕上：先回首页，解锁后再回来
      const back = current.fullPath
      await router.replace('/')
      await router.push(back)
    })
  })
}
