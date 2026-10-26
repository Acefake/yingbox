/**
 * 退出与主窗口快捷键：
 * - 退出前等 settings.json 的排队写入落盘（关窗时写的 player.windowBounds 不丢），只拦一次，超时也放行；
 * - DevTools 快捷键只在主窗口里生效，不注册系统级 globalShortcut（不抢别的程序的 F12）。
 * test-affected: repo-wide（读 src/main/index.ts 源码断言接线）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDevToolsToggle } from '../src/main/devtools-shortcut'
import { holdQuitForFlush } from '../src/main/settings/quit-flush'

type Listener = (event: { preventDefault(): void }) => void

function fakeApp(): {
  app: Parameters<typeof holdQuitForFlush>[0]
  quit: () => { prevented: boolean }
  exits: number[]
} {
  let listener: Listener | null = null
  const exits: number[] = []
  return {
    app: {
      on: (_event, fn) => {
        listener = fn
      },
      exit: code => exits.push(code ?? 0),
    },
    quit: () => {
      let prevented = false
      listener?.({ preventDefault: () => (prevented = true) })
      return { prevented }
    },
    exits,
  }
}

describe('退出前等设置落盘', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('拦住第一次 will-quit，写完后 exit；之后不再拦', async () => {
    const { app, quit, exits } = fakeApp()
    let release!: () => void
    const flush = vi.fn(() => new Promise<void>(resolve => (release = resolve)))
    holdQuitForFlush(app, flush, 3000)
    expect(quit().prevented).toBe(true)
    expect(flush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(exits).toEqual([])
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(exits).toEqual([0])
    expect(quit().prevented).toBe(false)
  })

  it('写入卡住时超时放行；写入失败也放行', async () => {
    const stuck = fakeApp()
    holdQuitForFlush(stuck.app, () => new Promise<void>(() => {}), 3000)
    stuck.quit()
    await vi.advanceTimersByTimeAsync(2999)
    expect(stuck.exits).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(stuck.exits).toEqual([0])

    const failing = fakeApp()
    holdQuitForFlush(failing.app, () => Promise.reject(new Error('磁盘满')))
    failing.quit()
    await vi.advanceTimersByTimeAsync(0)
    expect(failing.exits).toEqual([0])
  })
})

describe('DevTools 快捷键', () => {
  const key = (
    code: string,
    mods: Partial<Record<'control' | 'meta' | 'alt' | 'shift', boolean>> = {}
  ): Parameters<typeof isDevToolsToggle>[0] => ({
    type: 'keyDown',
    code,
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...mods,
  })
  const win = { platform: 'win32' as const, dev: false }
  const mac = { platform: 'darwin' as const, dev: false }

  it('F12 只在打包版切换（开发模式由 watchWindowShortcuts 处理）', () => {
    expect(isDevToolsToggle(key('F12'), win)).toBe(true)
    expect(isDevToolsToggle(key('F12'), { ...win, dev: true })).toBe(false)
    expect(isDevToolsToggle({ ...key('F12'), type: 'keyUp' }, win)).toBe(false)
  })

  it('Ctrl+Shift+I（macOS Cmd+Option+I）', () => {
    expect(
      isDevToolsToggle(key('KeyI', { control: true, shift: true }), win)
    ).toBe(true)
    expect(isDevToolsToggle(key('KeyI', { control: true }), win)).toBe(false)
    expect(isDevToolsToggle(key('KeyI', { meta: true, alt: true }), mac)).toBe(
      true
    )
    expect(
      isDevToolsToggle(key('KeyI', { control: true, shift: true }), mac)
    ).toBe(false)
  })

  it('主进程不再用 globalShortcut 注册 DevTools 快捷键', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(source).not.toMatch(/globalShortcut\.register\(/)
    expect(source).toMatch(/installDevToolsShortcut\(/)
  })
})
