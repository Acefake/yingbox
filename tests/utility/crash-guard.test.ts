/**
 * 崩溃守卫（main/utility/crash-guard.ts）与 UtilityHost 接上它之后的行为：
 * 启动即崩时不再每次调用都 fork 新进程（fork 风暴会拖死整机）。
 */
import { describe, expect, it } from 'vitest'
import {
  CrashGuard,
  MAX_QUICK_EXITS,
  QUICK_EXIT_MS,
  missingPackageIn,
} from '../../src/main/utility/crash-guard'
import { type UtilityChild, UtilityHost } from '../../src/main/utility/host'
import type { FromUtility, ToUtility } from '../../src/shared/utility/protocol'

describe('missingPackageIn', () => {
  it('认出 npm 包名，子路径只留包名，作用域包保留作用域', () => {
    expect(
      missingPackageIn(
        "Error: Cannot find module 'opencc-js/t2cn'\nRequire stack:"
      )
    ).toBe('opencc-js')
    expect(
      missingPackageIn(
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@jsquash/resize' imported from x"
      )
    ).toBe('@jsquash/resize')
  })
  it('相对路径、绝对路径（含盘符）不算缺依赖', () => {
    expect(
      missingPackageIn("Cannot find module './chunk-1.js'")
    ).toBeUndefined()
    expect(
      missingPackageIn("Cannot find module 'C:\\out\\main\\x.js'")
    ).toBeUndefined()
    expect(
      missingPackageIn("Cannot find module '/out/main/x.js'")
    ).toBeUndefined()
    expect(missingPackageIn('一切正常')).toBeUndefined()
  })
})

describe('CrashGuard', () => {
  it('连续秒退 MAX_QUICK_EXITS 次后停止重启；中间跑久了一次就清零', () => {
    let t = 0
    const guard = new CrashGuard('引擎', () => t)
    const quickExit = (): void => {
      guard.started()
      t += 100
      guard.exited()
    }
    for (let i = 1; i < MAX_QUICK_EXITS; i++) quickExit()
    expect(guard.blocked()).toBeUndefined()
    guard.started()
    t += QUICK_EXIT_MS + 1
    guard.exited()
    for (let i = 1; i < MAX_QUICK_EXITS; i++) quickExit()
    expect(guard.blocked()).toBeUndefined()
    quickExit()
    expect(guard.blocked()).toContain(`连续 ${MAX_QUICK_EXITS} 次启动即退出`)
  })
  it('stderr 分块到达也能认出缺依赖，原因里带包名和 pnpm install', () => {
    const guard = new CrashGuard('媒体库引擎')
    guard.started()
    guard.observe('Error: Cannot find mod')
    guard.observe("ule 'opencc-js'\n")
    expect(guard.blocked()).toBe(
      '媒体库引擎缺少依赖 opencc-js：请在项目目录运行 pnpm install 后重启应用'
    )
  })
})

/** 一 fork 就崩的假子进程。 */
class CrashingChild implements UtilityChild {
  private readonly exits: Array<(c: number) => void> = []
  private readonly errs: Array<(c: string) => void> = []
  readonly stderr = {
    on: (_: 'data', l: (c: string) => void): void => void this.errs.push(l),
  }
  readonly inbox: ToUtility[] = []
  postMessage(m: ToUtility): void {
    this.inbox.push(m)
  }
  on(event: 'message', listener: (message: FromUtility) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'message' | 'exit', listener: never): void {
    if (event === 'exit') this.exits.push(listener)
  }
  kill(): boolean {
    return true
  }
  crash(stderr?: string): void {
    if (stderr) this.errs.forEach(l => l(stderr))
    this.exits.forEach(l => l(1))
  }
}

function crashingHost(): {
  host: UtilityHost
  children: CrashingChild[]
  blocked: string[]
} {
  const children: CrashingChild[] = []
  const blocked: string[] = []
  let t = 0
  const host = new UtilityHost({
    name: '后台引擎',
    fork: () => {
      const child = new CrashingChild()
      children.push(child)
      return child
    },
    now: () => (t += 10),
    writeStderr: () => {},
    onBlocked: reason => blocked.push(reason),
  })
  return { host, children, blocked }
}

describe('UtilityHost + 崩溃守卫', () => {
  it('启动即崩：fork 到上限就不再 fork，之后的调用立即带原因失败', async () => {
    const { host, children, blocked } = crashingHost()
    for (let i = 0; i < MAX_QUICK_EXITS; i++) {
      const p = host.call('x', [])
      children[i].crash()
      await expect(p).rejects.toMatchObject({ code: 'unavailable' })
    }
    expect(children).toHaveLength(MAX_QUICK_EXITS)
    for (let i = 0; i < 20; i++) {
      await expect(host.call('x', [])).rejects.toMatchObject({
        code: 'unavailable',
        message: expect.stringContaining('已停止重启'),
      })
    }
    host.start()
    expect(children).toHaveLength(MAX_QUICK_EXITS)
    expect(blocked).toHaveLength(1)
    expect(host.blocked).toBeDefined()
  })
  it('缺依赖：第一次崩溃就停止重启，挂起的调用拿到「请运行 pnpm install」', async () => {
    const { host, children, blocked } = crashingHost()
    const p = host.call('x', [])
    children[0].crash("Error: Cannot find module 'opencc-js'")
    await expect(p).rejects.toMatchObject({
      message:
        '后台引擎缺少依赖 opencc-js：请在项目目录运行 pnpm install 后重启应用',
    })
    await expect(host.call('y', [])).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(children).toHaveLength(1)
    expect(blocked).toEqual([
      '后台引擎缺少依赖 opencc-js：请在项目目录运行 pnpm install 后重启应用',
    ])
  })
})
