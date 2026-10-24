/**
 * 板块密码锁的运行时状态（全应用一份）：锁的现状（是否设了密码、系统认证）、本次运行的解锁记录、
 * 正在等待的解锁请求；以及挂到路由上的守卫与窗口隐藏时的计时。
 *
 * 解锁只存在内存里：重启应用（或刷新渲染层）后重新锁定。
 */
import { shallowRef } from 'vue'
import type { Router } from 'vue-router'

import { getSetting } from '@/features/settings'

import type { SectionLockStatus } from '../../../../shared/section-lock'
import {
  type UnlockLedger,
  isLockActive,
  isUnlocked,
  markEntered,
  markLeft,
  markUnlocked,
  needsUnlock,
} from './rules'

/** 一个等待解锁的板块；SectionLockGate 显示它，结束时 resolve */
export interface UnlockRequest {
  name: string
  title: string
  resolve: (ok: boolean) => void
}

const bridge =
  typeof window !== 'undefined' ? window.api?.sectionLock : undefined

const status = shallowRef<SectionLockStatus>({
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

/** 当前等待解锁的请求（响应式） */
export function unlockRequest(): Readonly<typeof request> {
  return request
}

/** 重新读取锁的现状（改密码后调用） */
export async function refreshLockStatus(): Promise<void> {
  if (!bridge) return
  status.value = await bridge.status()
}

function ensureStatus(): Promise<void> {
  loaded ??= refreshLockStatus().catch(() => {})
  return loaded
}

function lockedNames(): string[] {
  return getSetting('lock.sections')
}

/** 板块此刻是否锁着（侧栏锁图标用；在 computed 里调用是响应式的） */
export function isSectionLocked(name: string): boolean {
  if (!isLockActive(name, lockedNames(), status.value.passwordSet)) return false
  const relock = getSetting('lock.relockMinutes')
  return !isUnlocked(ledger.value, name, relock, clock.value)
}

/** 按路径判断（侧栏导航项只有路径） */
export function isPathLocked(path: string): boolean {
  const name = resolveName(path)
  return Boolean(name) && isSectionLocked(name)
}

/** 请求解锁一个板块：弹出解锁界面，解锁成功返回 true；已有请求时先取消它 */
export function requestUnlock(name: string, title: string): Promise<boolean> {
  request.value?.resolve(false)
  return new Promise(resolve => {
    const pending: UnlockRequest = {
      name,
      title,
      resolve: ok => {
        if (request.value === pending) request.value = null
        if (ok) ledger.value = markUnlocked(ledger.value, name)
        resolve(ok)
      },
    }
    request.value = pending
  })
}

async function shouldPrompt(name: string): Promise<boolean> {
  if (!bridge || !name) return false
  await ensureStatus()
  return needsUnlock({
    name,
    lockedNames: lockedNames(),
    passwordSet: status.value.passwordSet,
    ledger: ledger.value,
    relockMinutes: getSetting('lock.relockMinutes'),
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
