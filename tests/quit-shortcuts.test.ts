/**
 * 退出与主窗口快捷键：
 * - 退出前等 settings.json 的排队写入落盘（关窗时写的 player.windowBounds 不丢），只拦一次，超时也放行；
 *   收尾走 app.quit()，退出流程仍会到达 quit 阶段（electron-updater 的退出时安装挂在那里）；
 * - DevTools 快捷键只在主窗口里生效，不注册系统级 globalShortcut（不抢别的程序的 F12）。
 * test-affected: repo-wide（读 src/main 源码断言接线）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type ShortcutContents,
  type ShortcutInput,
  installDevToolsShortcut,
  isDevToolsToggle,
} from '../src/main/devtools-shortcut'
import { holdQuitForFlush } from '../src/main/settings/quit-flush'

type QuitListener = (event: { preventDefault(): void }) => void

/**
 * 模拟 Electron 的退出流程：quit() 依次发 will-quit，没被拦就到达 quit 阶段。
 * 只收 will-quit 监听，监听别的事件名直接判失败。
 */
function fakeApp(): {
  app: Parameters<typeof holdQuitForFlush>[0]
  quit: () => { prevented: boolean }
  reachedQuit: () => number
} {
  const listeners: QuitListener[] = []
  let quitPhase = 0
  const quit = (): { prevented: boolean } => {
    let prevented = false
    for (const fn of listeners) fn({ preventDefault: () => (prevented = true) })
    if (!prevented) quitPhase++
    return { prevented }
  }
  return {
    app: {
      on: (event, fn) => {
        if (event !== 'will-quit') throw new Error(`监听了 ${String(event)}`)
        listeners.push(fn)
      },
      quit: () => void quit(),
    },
    quit,
    reachedQuit: () => quitPhase,
  }
}

describe('退出前等设置落盘', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('拦住第一次 will-quit，写完后重新 quit 并到达 quit 阶段；之后不再拦', async () => {
    const { app, quit, reachedQuit } = fakeApp()
    let release!: () => void
    const flush = vi.fn(() => new Promise<void>(resolve => (release = resolve)))
    holdQuitForFlush(app, flush, 3000)
    expect(quit().prevented).toBe(true)
    expect(flush).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(reachedQuit()).toBe(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(reachedQuit()).toBe(1)
    expect(quit().prevented).toBe(false)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('写入期间再次退出也拦住，只 flush 一次', async () => {
    const { app, quit, reachedQuit } = fakeApp()
    let release!: () => void
    const flush = vi.fn(() => new Promise<void>(resolve => (release = resolve)))
    holdQuitForFlush(app, flush, 3000)
    quit()
    expect(quit().prevented).toBe(true)
    expect(flush).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(reachedQuit()).toBe(1)
  })

  it('写入卡住时超时放行；写入失败也放行', async () => {
    const stuck = fakeApp()
    holdQuitForFlush(stuck.app, () => new Promise<void>(() => {}), 3000)
    stuck.quit()
    await vi.advanceTimersByTimeAsync(2999)
    expect(stuck.reachedQuit()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(stuck.reachedQuit()).toBe(1)

    const failing = fakeApp()
    holdQuitForFlush(failing.app, () => Promise.reject(new Error('磁盘满')))
    failing.quit()
    await vi.advanceTimersByTimeAsync(0)
    expect(failing.reachedQuit()).toBe(1)
  })
})

const key = (
  code: string,
  mods: Partial<Record<'control' | 'meta' | 'alt' | 'shift', boolean>> = {}
): ShortcutInput => ({
  type: 'keyDown',
  code,
  isAutoRepeat: false,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods,
})
const win = { platform: 'win32' as const, dev: false }
const mac = { platform: 'darwin' as const, dev: false }

describe('DevTools 快捷键判定', () => {
  it('F12 只在打包版切换（开发模式由 watchWindowShortcuts 处理）', () => {
    expect(isDevToolsToggle(key('F12'), win)).toBe(true)
    expect(isDevToolsToggle(key('F12'), { ...win, dev: true })).toBe(false)
    expect(isDevToolsToggle({ ...key('F12'), type: 'keyUp' }, win)).toBe(false)
    expect(isDevToolsToggle(key('F12', { shift: true }), win)).toBe(false)
  })

  it('Ctrl+Shift+I（macOS Cmd+Option+I），多一个修饰键都不算', () => {
    const winI = (mods: Parameters<typeof key>[1]): boolean =>
      isDevToolsToggle(key('KeyI', mods), win)
    const macI = (mods: Parameters<typeof key>[1]): boolean =>
      isDevToolsToggle(key('KeyI', mods), mac)
    expect(winI({ control: true, shift: true })).toBe(true)
    expect(winI({ control: true })).toBe(false)
    expect(winI({ control: true, shift: true, alt: true })).toBe(false)
    expect(winI({ control: true, shift: true, meta: true })).toBe(false)
    expect(macI({ meta: true, alt: true })).toBe(true)
    expect(macI({ control: true, shift: true })).toBe(false)
    expect(macI({ meta: true, alt: true, shift: true })).toBe(false)
    expect(macI({ meta: true, alt: true, control: true })).toBe(false)
  })

  it('按住不放的重复按键不切换', () => {
    expect(isDevToolsToggle({ ...key('F12'), isAutoRepeat: true }, win)).toBe(
      false
    )
  })
})

describe('DevTools 快捷键接线', () => {
  function fakeContents(destroyed = false): {
    contents: ShortcutContents
    press: (input: ShortcutInput) => boolean
    events: string[]
    toggles: () => number
  } {
    const events: string[] = []
    let handler: Parameters<ShortcutContents['on']>[1] | null = null
    let toggled = 0
    return {
      contents: {
        on: (event, fn) => {
          events.push(event)
          handler = fn
        },
        isDestroyed: () => destroyed,
        toggleDevTools: () => void toggled++,
      },
      press: input => {
        let prevented = false
        handler?.({ preventDefault: () => (prevented = true) }, input)
        return prevented
      },
      events,
      toggles: () => toggled,
    }
  }

  it('只挂窗口自己的 before-input-event，命中时吞掉按键并切换', () => {
    const fake = fakeContents()
    installDevToolsShortcut(fake.contents, win)
    expect(fake.events).toEqual(['before-input-event'])
    expect(fake.press(key('KeyA'))).toBe(false)
    expect(fake.press(key('F12'))).toBe(true)
    expect(fake.toggles()).toBe(1)
  })

  it('窗口已销毁时不调 toggleDevTools', () => {
    const fake = fakeContents(true)
    installDevToolsShortcut(fake.contents, win)
    fake.press(key('F12'))
    expect(fake.toggles()).toBe(0)
  })

  const mainDir = join(__dirname, '../src/main')
  const sources = (readdirSync(mainDir, { recursive: true }) as string[])
    .map(file => file.replace(/\\/g, '/'))
    .filter(file => file.endsWith('.ts'))
    .map(file => ({
      file,
      text: readFileSync(join(mainDir, file), 'utf8'),
    }))

  it('主进程任何地方都不用 globalShortcut 注册 DevTools 快捷键', () => {
    const devtoolsAccel = /F12|\+I['"`]|toggleDevTools/
    for (const { file, text } of sources) {
      const calls = text.match(/globalShortcut\.register\([^)]*\)[^\n]*/g) ?? []
      for (const call of calls) {
        expect(`${file}: ${call}`).not.toMatch(devtoolsAccel)
      }
    }
  })

  it('只在 createWindow 里给主窗口安装，别的窗口不装', () => {
    const callers = sources.filter(
      ({ file, text }) =>
        file !== 'devtools-shortcut.ts' &&
        /installDevToolsShortcut\(/.test(text)
    )
    expect(callers.map(({ file }) => file)).toEqual(['index.ts'])
    const index = callers[0].text
    expect(index.match(/installDevToolsShortcut\(/g)).toHaveLength(1)
    const createWindow = index.slice(
      index.indexOf('function createWindow('),
      index.indexOf('function showMainWindow(')
    )
    expect(createWindow).toMatch(
      /installDevToolsShortcut\(mainWindow\.webContents,/
    )
  })

  it('设置模块在初始化时挂上退出前落盘', () => {
    const settings = sources.find(({ file }) => file === 'settings/index.ts')
    expect(settings?.text).toMatch(
      /holdQuitForFlush\(app, \(\) => opened\.flush\(\)\)/
    )
  })
})
