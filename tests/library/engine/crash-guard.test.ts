import { describe, expect, it } from 'vitest'
import {
  CrashGuard,
  MAX_QUICK_EXITS,
  QUICK_EXIT_MS,
  missingPackageIn,
} from '../../../src/main/library/crash-guard'

describe('missingPackageIn', () => {
  it('子路径只留包名，作用域包保留作用域', () => {
    expect(missingPackageIn("Error: Cannot find module 'opencc-js/t2cn'")).toBe(
      'opencc-js'
    )
    expect(
      missingPackageIn(
        "Cannot find package '@jsquash/webp' imported from C:\\x\\webp-worker.js"
      )
    ).toBe('@jsquash/webp')
  })

  it('相对 / 绝对路径不算缺依赖', () => {
    expect(missingPackageIn("Cannot find module './chunk.js'")).toBeUndefined()
    expect(
      missingPackageIn("Cannot find module 'C:\\app\\out\\main\\x.js'")
    ).toBeUndefined()
    expect(missingPackageIn("Cannot find module '/app/x.js'")).toBeUndefined()
    expect(missingPackageIn('普通日志')).toBeUndefined()
  })
})

describe('CrashGuard', () => {
  const clock = (): { now: () => number; tick: (ms: number) => void } => {
    let t = 0
    return { now: () => t, tick: ms => (t += ms) }
  }

  it('缺依赖后立即不再重启，并提示 pnpm install', () => {
    const c = clock()
    const guard = new CrashGuard(c.now)
    guard.started()
    guard.observe("Error: Cannot find module 'opencc-js/t2cn'\n")
    guard.exited()
    expect(guard.blocked()).toContain('opencc-js')
    expect(guard.blocked()).toContain('pnpm install')
  })

  it('连续秒退达到上限才停止，中间跑久了会清零', () => {
    const c = clock()
    const guard = new CrashGuard(c.now)
    for (let i = 0; i < MAX_QUICK_EXITS - 1; i++) {
      guard.started()
      c.tick(100)
      guard.exited()
    }
    expect(guard.blocked()).toBeUndefined()
    guard.started()
    c.tick(QUICK_EXIT_MS + 1)
    guard.exited()
    expect(guard.blocked()).toBeUndefined()
    for (let i = 0; i < MAX_QUICK_EXITS; i++) {
      guard.started()
      c.tick(100)
      guard.exited()
    }
    expect(guard.blocked()).toContain('停止重启')
  })
})
