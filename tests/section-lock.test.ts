import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  hashPassword,
  parseHash,
  verifyPassword,
} from '../src/main/section-lock/hash'
import {
  LOCKOUT_MS,
  MAX_FAILURES,
  MAX_LOCKOUT_MS,
  createAttemptLimiter,
} from '../src/main/section-lock/rules'
import {
  type UnlockLedger,
  isUnlocked,
  lockableSections,
  markEntered,
  markLeft,
  markUnlocked,
  needsUnlock,
  retryText,
} from '../src/renderer/src/features/section-lock/rules'
import { routes } from '../src/renderer/src/router/routers'
import {
  parseLockConfig,
  parseLockPassword,
  weakensLock,
} from '../src/shared/section-lock'

/**
 * 板块密码锁：scrypt 哈希与校验、输错限流、新密码规则、可锁板块列表、
 * 解锁记录随进入 / 离开的变化与重新锁定，以及设置项与接线。
 * test-affected: repo-wide（读源码断言接线）
 */

const root = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

describe('密码哈希', () => {
  it('哈希带参数与盐，不含明文；同一密码两次哈希不同；校验通过 / 不通过', async () => {
    const first = await hashPassword('我的密码 1234')
    const second = await hashPassword('我的密码 1234')
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/)
    expect(first).not.toContain('1234')
    expect(first).not.toBe(second)
    expect(await verifyPassword('我的密码 1234', first)).toBe(true)
    expect(await verifyPassword('我的密码 12345', first)).toBe(false)
    expect(await verifyPassword('', first)).toBe(false)
  })

  it('按 NFC 归一：组合字符与预组合字符视为同一密码', async () => {
    const stored = await hashPassword('caf\u00e9', { N: 1024, r: 8, p: 1 })
    expect(await verifyPassword('cafe\u0301', stored)).toBe(true)
  })

  it('损坏或参数越界的哈希一律不通过', async () => {
    const stored = await hashPassword('abcd', { N: 1024, r: 8, p: 1 })
    expect(parseHash(stored)?.options).toEqual({ N: 1024, r: 8, p: 1 })
    const parts = stored.split('$')
    const swap = (index: number, value: string): string =>
      parts.map((part, i) => (i === index ? value : part)).join('$')
    expect(parseHash('plain-text')).toBeNull()
    expect(parseHash(swap(0, 'bcrypt'))).toBeNull()
    expect(parseHash(swap(1, '1000'))).toBeNull() // 不是 2 的幂
    expect(parseHash(swap(1, String(1 << 20)))).toBeNull() // 内存过大
    expect(parseHash(swap(2, '99'))).toBeNull()
    expect(parseHash(swap(5, 'AAAA'))).toBeNull() // 长度不对
    expect(await verifyPassword('abcd', swap(1, String(1 << 20)))).toBe(false)
  })
})

describe('输错限流', () => {
  it('连续输错 5 次暂停 30 秒，再错满一轮翻倍，成功后清零', () => {
    let now = 0
    const limiter = createAttemptLimiter(() => now)
    for (let i = 0; i < MAX_FAILURES - 1; i++) limiter.record(false)
    expect(limiter.check()).toBe(0)
    limiter.record(false)
    expect(limiter.check()).toBe(LOCKOUT_MS)
    now += LOCKOUT_MS
    expect(limiter.check()).toBe(0)
    for (let i = 0; i < MAX_FAILURES; i++) limiter.record(false)
    expect(limiter.check()).toBe(LOCKOUT_MS * 2)
    now += LOCKOUT_MS * 2
    limiter.record(true)
    for (let i = 0; i < MAX_FAILURES; i++) limiter.record(false)
    expect(limiter.check()).toBe(LOCKOUT_MS)
  })

  it('暂停时长有上限', () => {
    let now = 0
    const limiter = createAttemptLimiter(() => now)
    for (let round = 0; round < 12; round++) {
      for (let i = 0; i < MAX_FAILURES; i++) limiter.record(false)
      expect(limiter.check()).toBeLessThanOrEqual(MAX_LOCKOUT_MS)
      now += limiter.check()
    }
  })
})

describe('新密码规则', () => {
  it('4–128 个字符（按字符计），不含换行与空字符', () => {
    expect(parseLockPassword('abcd')).toBe('abcd')
    expect(parseLockPassword('abc')).toBeUndefined()
    expect(parseLockPassword('😀😀😀😀')).toBe('😀😀😀😀')
    expect(parseLockPassword('a'.repeat(129))).toBeUndefined()
    expect(parseLockPassword('abcd\n')).toBeUndefined()
    expect(parseLockPassword(1234)).toBeUndefined()
  })
})

describe('可锁定的板块', () => {
  it('读路由表：首页与重定向不列，成人板块只在成人模式下列出', () => {
    expect(lockableSections(routes, false).map(item => item.name)).toEqual([
      'Movie',
      'TV',
      'Calendar',
      'Live',
    ])
    const adult = lockableSections(routes, true)
    expect(adult.map(item => [item.name, item.title, item.adultOnly])).toEqual([
      ['Movie', '电影', false],
      ['TV', '剧集', false],
      ['Calendar', '追剧日历', false],
      ['Live', '直播', false],
      ['Jav', '番号', true],
      ['AV', 'AV资源', true],
    ])
  })

  it('新加的板块自动出现；meta.lockable === false、带参数的路径不列', () => {
    const extra = [
      { path: '/amane', name: 'Amane', meta: { title: '新板块' } },
      { path: '/x', name: 'X', meta: { title: 'X', lockable: false } },
      { path: '/item/:id', name: 'Item', meta: { title: '详情' } },
      { path: '/y', meta: { title: '无名' } },
    ]
    expect(lockableSections(extra, false).map(item => item.name)).toEqual([
      'Amane',
    ])
  })
})

describe('解锁记录', () => {
  const base = {
    name: 'AV',
    lockedNames: ['AV'],
    passwordSet: true,
    relockMinutes: 5,
    now: 0,
  }

  it('没设密码或没勾选时不锁；勾了且没解锁过时要解锁', () => {
    expect(needsUnlock({ ...base, ledger: {} })).toBe(true)
    expect(needsUnlock({ ...base, passwordSet: false, ledger: {} })).toBe(false)
    expect(needsUnlock({ ...base, lockedNames: [], ledger: {} })).toBe(false)
  })

  it('解锁后在板块里一直有效；离开超过 N 分钟重新锁定，回来得早则继续有效', () => {
    let ledger: UnlockLedger = markUnlocked({}, 'AV')
    expect(needsUnlock({ ...base, ledger, now: 10 * 60_000 })).toBe(false)
    ledger = markLeft(ledger, 'AV', 1000)
    // 已在计时的不重置
    expect(markLeft(ledger, 'AV', 9999)).toBe(ledger)
    expect(isUnlocked(ledger, 'AV', 5, 1000 + 5 * 60_000 - 1)).toBe(true)
    expect(isUnlocked(ledger, 'AV', 5, 1000 + 5 * 60_000)).toBe(false)
    ledger = markEntered(ledger, 'AV')
    expect(ledger.AV).toBeNull()
    expect(isUnlocked(ledger, 'AV', 5, 10 ** 9)).toBe(true)
  })

  it('自动锁定设为 0：本次运行内一直有效', () => {
    const ledger = markLeft(markUnlocked({}, 'AV'), 'AV', 0)
    expect(isUnlocked(ledger, 'AV', 0, 10 ** 9)).toBe(true)
  })

  it('没解锁过的板块进出不产生记录', () => {
    const ledger: UnlockLedger = {}
    expect(markLeft(ledger, 'AV', 1)).toBe(ledger)
    expect(markEntered(ledger, 'AV')).toBe(ledger)
  })

  it('等待提示：秒 / 分钟', () => {
    expect(retryText(29_100)).toBe('输错次数过多，请 30 秒后再试')
    expect(retryText(120_000)).toBe('输错次数过多，请 2 分钟后再试')
  })
})

describe('锁的配置', () => {
  it('板块只收路由名列表并去重；重新锁定 0–1440 分钟整数', () => {
    expect(
      parseLockConfig({ sections: ['AV', 'Jav', 'AV'], relockMinutes: 15 })
    ).toEqual({ sections: ['AV', 'Jav'], relockMinutes: 15 })
    expect(
      parseLockConfig({ sections: ['../x'], relockMinutes: 0 })
    ).toBeUndefined()
    expect(
      parseLockConfig({ sections: 'AV', relockMinutes: 0 })
    ).toBeUndefined()
    expect(parseLockConfig({ sections: [], relockMinutes: -1 })).toBeUndefined()
    expect(
      parseLockConfig({ sections: [], relockMinutes: 1.5 })
    ).toBeUndefined()
  })

  it('取消锁定、放宽重新锁定算降低保护；增加锁定、收紧不算', () => {
    const base = { sections: ['AV', 'Jav'], relockMinutes: 5 }
    expect(weakensLock(base, { ...base, sections: ['AV'] })).toBe(true)
    expect(weakensLock(base, { ...base, relockMinutes: 0 })).toBe(true)
    expect(weakensLock(base, { ...base, relockMinutes: 15 })).toBe(true)
    expect(weakensLock(base, { ...base, sections: ['Jav', 'AV', 'X'] })).toBe(
      false
    )
    expect(weakensLock(base, { ...base, relockMinutes: 1 })).toBe(false)
    expect(
      weakensLock({ ...base, relockMinutes: 0 }, { ...base, relockMinutes: 5 })
    ).toBe(false)
  })
})

describe('接线', () => {
  it('主进程注册 sectionLock 域；密码只以哈希落盘', () => {
    expect(read('src/main/index.ts')).toMatch(
      /await registerSectionLockIpc\(\)/
    )
    const main = read('src/main/section-lock/index.ts')
    expect(main).toMatch(/implement\(sectionLock/)
    expect(main).toMatch(/createSectionLockStore\(/)
    expect(main).toMatch(/store\.grantForSystemAuth\(\)/)
    expect(main).toMatch(/promptTouchID/)
  })

  it('渲染层：路由装守卫、根组件挂解锁界面、侧栏显示锁图标、桌面端登记设置分区', () => {
    expect(read('src/renderer/src/router/index.ts')).toMatch(
      /installSectionLockGuard\(router\)/
    )
    expect(read('src/renderer/src/App.vue')).toMatch(/<SectionLockGate \/>/)
    expect(
      read('src/renderer/src/features/shell/components/AppSidebar.vue')
    ).toMatch(/isPathLocked\(item\.path\)/)
    expect(read('src/renderer/src/main.ts')).toMatch(
      /if \(sectionLockAvailable\)\s+registerSettingsSection\(sectionLockSettingsSection\(routes\)\)/
    )
  })
})
