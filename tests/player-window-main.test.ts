/**
 * 主进程的独立播放器窗口（src/main/player-window）：
 * - 位置与大小：首次按主屏居中 16:9，之后沿用记下的；不在任何屏幕上时回到主屏，尺寸夹进工作区；
 * - 单例：没开就建，页面就绪前的载荷存着等 ready 取；开着就发 play 换片并聚焦；
 * - 调用方校验：open / command 只认主窗口，ready / progress / state / reply / navigate 只认播放器窗口；
 * - 进度与在播状态转给主窗口；遥控请求转给播放器窗口并等回执，超时 / 关窗按失败；
 * - 关窗记位置、通知主窗口没在播；置顶跟设置走。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PLAYER_WINDOW_MIN,
  defaultBounds,
  restoreBounds,
} from '../src/main/player-window/bounds'

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }
const SIDE = { x: 1920, y: 0, width: 1280, height: 1000 }

describe('播放器窗口的位置与大小', () => {
  it('首次打开：16:9，宽高都不超过主屏工作区的 70%，居中', () => {
    expect(defaultBounds(PRIMARY)).toEqual({
      x: 313,
      y: 156,
      width: 1294,
      height: 728,
    })
  })

  it('沿用记下的；落在副屏上就用副屏，超出的部分挪回来、太大的缩进工作区', () => {
    const saved = { x: 2000, y: 100, width: 900, height: 500 }
    expect(restoreBounds(saved, [PRIMARY, SIDE], PRIMARY)).toEqual(saved)
    expect(
      restoreBounds(
        { x: 2500, y: 600, width: 900, height: 600 },
        [PRIMARY, SIDE],
        PRIMARY
      )
    ).toEqual({ x: 2300, y: 400, width: 900, height: 600 })
    expect(
      restoreBounds(
        { x: 1900, y: 0, width: 1500, height: 1000 },
        [PRIMARY, SIDE],
        PRIMARY
      )
    ).toEqual({ x: 1920, y: 0, width: 1280, height: 1000 })
  })

  it('拔了副屏 / 没记过：回到主屏居中；尺寸不小于最小值', () => {
    const gone = { x: 4000, y: 100, width: 900, height: 500 }
    expect(restoreBounds(gone, [PRIMARY], PRIMARY)).toEqual(
      defaultBounds(PRIMARY)
    )
    expect(restoreBounds(null, [PRIMARY], PRIMARY)).toEqual(
      defaultBounds(PRIMARY)
    )
    const tiny = defaultBounds({ x: 0, y: 0, width: 500, height: 300 })
    expect(tiny.width).toBeGreaterThanOrEqual(PLAYER_WINDOW_MIN.width)
    expect(tiny.height).toBeGreaterThanOrEqual(PLAYER_WINDOW_MIN.height)
  })
})

// ── 窗口与 IPC：electron 换成替身 ─────────────────────────────

type Listener = (...args: unknown[]) => void

const h = vi.hoisted(() => {
  class FakeContents {
    sent: Array<[string, unknown]> = []
    destroyed = false
    private listeners = new Map<string, Listener[]>()
    send(channel: string, payload: unknown): void {
      this.sent.push([channel, payload])
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    on(name: string, fn: Listener): void {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn])
    }
    windowOpenHandler: unknown = null
    setWindowOpenHandler(fn: unknown): void {
      this.windowOpenHandler = fn
    }
    emit(name: string, ...args: unknown[]): void {
      for (const fn of this.listeners.get(name) ?? []) fn(...args)
    }
  }
  class FakeWindow {
    static all: FakeWindow[] = []
    webContents = new FakeContents()
    options: Record<string, unknown>
    loaded = ''
    focused = 0
    onTop: boolean
    closed = false
    private listeners = new Map<string, Listener[]>()
    constructor(options: Record<string, unknown>) {
      this.options = options
      this.onTop = Boolean(options.alwaysOnTop)
      FakeWindow.all.push(this)
    }
    on(name: string, fn: Listener): void {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn])
    }
    once(name: string, fn: Listener): void {
      this.on(name, fn)
    }
    emit(name: string, ...args: unknown[]): void {
      for (const fn of this.listeners.get(name) ?? []) fn(...args)
    }
    loadFile(file: string): Promise<void> {
      this.loaded = file
      return Promise.resolve()
    }
    loadURL(url: string): Promise<void> {
      this.loaded = url
      return Promise.resolve()
    }
    isMinimized(): boolean {
      return false
    }
    isVisible(): boolean {
      return true
    }
    isDestroyed(): boolean {
      return this.closed
    }
    shown = 0
    restore(): void {
      this.shown++
    }
    show(): void {
      this.shown++
    }
    focus(): void {
      this.focused++
    }
    setAlwaysOnTop(on: boolean): void {
      this.onTop = on
    }
    getNormalBounds(): Record<string, number> {
      return { x: 10, y: 20, width: 800, height: 450 }
    }
    close(): void {
      if (this.closed) return
      this.emit('close')
      this.closed = true
      this.webContents.destroyed = true
      this.emit('closed')
    }
    static getAllWindows(): FakeWindow[] {
      return FakeWindow.all.filter(w => !w.closed)
    }
  }
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >()
  const values: Record<string, unknown> = {
    'player.windowBounds': null,
    'player.windowOnTop': false,
  }
  const settingListeners: Array<
    (change: { key: string; value: unknown }) => void
  > = []
  return { FakeWindow, FakeContents, handlers, values, settingListeners }
})

vi.mock('electron', () => ({
  BrowserWindow: h.FakeWindow,
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, ...args: unknown[]) => unknown
    ) => h.handlers.set(channel, fn),
    on: () => {},
  },
  screen: {
    getAllDisplays: () => [{ workArea: PRIMARY }],
    getPrimaryDisplay: () => ({ workArea: PRIMARY }),
  },
  shell: { openExternal: async () => {} },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../src/main/settings', () => ({
  settingsStore: () => ({
    get: (key: string) => h.values[key],
    set: (key: string, value: unknown) => {
      h.values[key] = value
      return { key, value }
    },
  }),
  onSettingChanged: (fn: (change: { key: string; value: unknown }) => void) =>
    h.settingListeners.push(fn),
}))

type Win = InstanceType<typeof h.FakeWindow>

let main: Win
let control: { close: () => void }

const call = async (
  channel: string,
  sender: unknown,
  ...args: unknown[]
): Promise<unknown> =>
  h.handlers.get(`playerWindow:${channel}`)!({ sender }, ...args)

const player = (): Win => h.FakeWindow.all[1]
const sentTo = (win: Win, channel: string): unknown[] =>
  win.webContents.sent
    .filter(([c]) => c === `playerWindow:${channel}`)
    .map(([, p]) => p)

beforeEach(async () => {
  vi.resetModules()
  h.FakeWindow.all = []
  h.handlers.clear()
  h.settingListeners.length = 0
  h.values['player.windowBounds'] = null
  h.values['player.windowOnTop'] = false
  main = new h.FakeWindow({})
  const { registerPlayerWindow } = await import('../src/main/player-window')
  control = registerPlayerWindow({ getMainWindow: () => main as never })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('播放器窗口：单例与载荷', () => {
  it('主窗口开播：建窗口（无边框、黑底、播放器专用 preload、player.html），载荷等 ready 取走', async () => {
    await call('open', main.webContents, { url: 'a' })
    const win = player()
    expect(h.FakeWindow.all).toHaveLength(2)
    expect(win.options).toMatchObject({
      frame: false,
      backgroundColor: '#000000',
      width: 1294,
      height: 728,
      minWidth: PLAYER_WINDOW_MIN.width,
      alwaysOnTop: false,
    })
    const prefs = win.options.webPreferences as Record<string, unknown>
    expect(String(prefs.preload)).toMatch(/preload[\\/]index\.js$/)
    expect(prefs.additionalArguments).toEqual(['--yingbox-player-window'])
    expect(prefs.sandbox).toBe(true)
    expect(win.loaded).toMatch(/renderer[\\/]player\.html$/)
    // 就绪前又点了别的：只留最后一份
    await call('open', main.webContents, { url: 'b' })
    expect(h.FakeWindow.all).toHaveLength(2)
    expect(await call('ready', win.webContents)).toEqual({ url: 'b' })
    expect(await call('ready', win.webContents)).toBeNull()
  })

  it('开着时再开播：发 play 换片并聚焦，不建第二个窗口', async () => {
    await call('open', main.webContents, { url: 'a' })
    const win = player()
    await call('ready', win.webContents)
    const before = win.focused
    await call('open', main.webContents, { url: 'c' })
    expect(h.FakeWindow.all).toHaveLength(2)
    expect(sentTo(win, 'play')).toEqual([{ url: 'c' }])
    expect(win.focused).toBe(before + 1)
  })

  it('调用方校验：播放器窗口不能 open，主窗口不能冒充播放器窗口报进度', async () => {
    await call('open', main.webContents, { url: 'a' })
    const win = player()
    await expect(call('open', win.webContents, { url: 'x' })).rejects.toThrow(
      '只有主窗口可以调用'
    )
    await expect(
      call('progress', main.webContents, { kind: 'flush' })
    ).rejects.toThrow('只有播放器窗口可以调用')
    await expect(call('ready', main.webContents)).rejects.toThrow()
  })
})

describe('播放器窗口：往来转发', () => {
  it('进度事件、在播状态、要打开的地址都转给主窗口', async () => {
    await call('open', main.webContents, { url: 'a' })
    const win = player()
    await call('ready', win.webContents)
    await call('progress', win.webContents, { kind: 'flush' })
    const state = {
      title: '片',
      private: false,
      controllable: true,
      plotQa: false,
      seconds: 3,
    }
    await call('state', win.webContents, state)
    await call('navigate', win.webContents, '/tv')
    expect(sentTo(main, 'relay')).toEqual([{ kind: 'flush' }])
    expect(sentTo(main, 'session')).toEqual([state])
    expect(sentTo(main, 'route')).toEqual(['/tv'])
    expect(main.focused).toBeGreaterThan(0)
  })

  it('遥控：没开窗口直接失败；开着就转过去等回执；超时按失败', async () => {
    expect(
      await call('command', main.webContents, {
        kind: 'remote',
        command: { kind: 'rate', value: 2 },
      })
    ).toEqual({ ok: false, text: '现在没有正在播放的视频' })

    await call('open', main.webContents, { url: 'a' })
    const win = player()
    await call('ready', win.webContents)
    const pending = call('command', main.webContents, {
      kind: 'remote',
      command: { kind: 'rate', value: 2 },
    })
    const [request] = sentTo(win, 'remote') as Array<{ id: number }>
    await call('reply', win.webContents, request.id, { ok: true, text: '好' })
    expect(await pending).toEqual({ ok: true, text: '好' })

    vi.useFakeTimers()
    const slow = call('command', main.webContents, {
      kind: 'ask',
      question: '他是谁',
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await slow).toEqual({ ok: false, text: '播放器没有响应' })
  })

  it('关窗：记下位置，主窗口收到没在播，等着的遥控按失败；主窗口关闭时一起关', async () => {
    await call('open', main.webContents, { url: 'a' })
    const win = player()
    await call('ready', win.webContents)
    const pending = call('command', main.webContents, {
      kind: 'remote',
      command: { kind: 'rate', value: 2 },
    })
    control.close()
    expect(win.closed).toBe(true)
    expect(h.values['player.windowBounds']).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 450,
    })
    expect(sentTo(main, 'session')).toEqual([null])
    expect(await pending).toEqual({ ok: false, text: '播放器已关闭' })
    // 再开：新窗口按记下的位置
    await call('open', main.webContents, { url: 'b' })
    expect(h.FakeWindow.all.at(-1)!.options).toMatchObject({
      x: 10,
      y: 20,
      width: 800,
      height: 450,
    })
  })

  it('置顶跟设置 player.windowOnTop 走', async () => {
    h.values['player.windowOnTop'] = true
    await call('open', main.webContents, { url: 'a' })
    const win = player()
    expect(win.onTop).toBe(true)
    for (const fn of h.settingListeners)
      fn({ key: 'player.windowOnTop', value: false })
    expect(win.onTop).toBe(false)
  })
})
