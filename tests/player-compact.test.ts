import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 「缩小置顶」：内置独立播放窗口（BrowserWindow.setAlwaysOnTop + 缩到右下角）与 mpv 内核（ontop + geometry）。
 * mpv 没有 BrowserWindow、不能画中画，这是它的替代；内置窗口用它保住字幕 / 自动连播（画中画只有画面）。
 */

const electron = vi.hoisted(() => {
  const noop = (): void => undefined
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windows: FakeWindow[] = []
  class FakeWindow {
    bounds = { x: 100, y: 80, width: 960, height: 600 }
    onTop = false
    minSize = [640, 360]
    destroyed = false
    webContents = {
      on: noop,
      send: noop,
      isDestroyed: (): boolean => false,
      getURL: (): string => 'file:///index.html#/player-popout',
    }
    constructor() {
      windows.push(this)
    }
    // 播放窗口的事件、加载、显示在这里都用不到
    on = noop
    once = noop
    loadFile = noop
    loadURL = noop
    show = noop
    focus = noop
    setTitle = noop
    isMinimized(): boolean {
      return false
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    getBounds(): typeof this.bounds {
      return { ...this.bounds }
    }
    setBounds(b: typeof this.bounds): void {
      this.bounds = { ...b }
    }
    setAlwaysOnTop(flag: boolean): void {
      this.onTop = flag
    }
    setMinimumSize(w: number, h: number): void {
      this.minSize = [w, h]
    }
  }
  return { handlers, windows, FakeWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: electron.FakeWindow,
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) =>
      electron.handlers.set(channel, fn),
    on: () => undefined,
  },
  screen: {
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    }),
  },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const invoke = (channel: string, ...args: unknown[]): unknown =>
  electron.handlers.get(channel)!({ sender: {} }, ...args)

describe('内置独立播放窗口：缩小置顶', () => {
  beforeEach(() => {
    vi.resetModules()
    electron.handlers.clear()
    electron.windows.length = 0
  })

  it('右下角小窗的位置：留边距、在工作区内', async () => {
    const { compactBounds } = await import('../src/main/player-window')
    expect(compactBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 1416,
      y: 746,
      width: 480,
      height: 270,
    })
    expect(compactBounds({ x: -1280, y: 0, width: 1280, height: 984 })).toEqual(
      { x: -504, y: 690, width: 480, height: 270 }
    )
  })

  it('打开 → 缩到右下角并置顶；还原 → 回到原来的位置大小、取消置顶', async () => {
    const { registerPlayerWindowIpc } =
      await import('../src/main/player-window')
    registerPlayerWindowIpc()
    expect(await invoke('player:setCompact', true)).toEqual({
      success: false,
      compact: false,
    })
    invoke('player:open', { url: 'https://a/b.m3u8' })
    const win = electron.windows[0]
    expect(await invoke('player:setCompact', true)).toEqual({
      success: true,
      compact: true,
    })
    expect(win.onTop).toBe(true)
    expect(win.bounds).toEqual({ x: 1416, y: 746, width: 480, height: 270 })
    expect(win.minSize[0]).toBeLessThanOrEqual(480)
    // 重复打开不覆盖记下的原尺寸
    await invoke('player:setCompact', true)
    expect(await invoke('player:setCompact', false)).toEqual({
      success: true,
      compact: false,
    })
    expect(win.onTop).toBe(false)
    expect(win.bounds).toEqual({ x: 100, y: 80, width: 960, height: 600 })
    expect(win.minSize).toEqual([640, 360])
  })

  it('契约：参数必须是布尔值', async () => {
    const { registerPlayerWindowIpc } =
      await import('../src/main/player-window')
    registerPlayerWindowIpc()
    expect(() => invoke('player:setCompact', 'yes')).toThrow(
      /player:setCompact/
    )
  })
})

// ── mpv ────────────────────────────────────────────────────────────────

const mpvFakes = vi.hoisted(() => {
  const sent: unknown[][] = []
  return {
    sent,
    socket: null as null | (EventEmitter & { connected: boolean }),
  }
})

vi.mock('../src/main/mpv-socket', async () => {
  const { EventEmitter: Emitter } = await import('events')
  class MpvSocket extends Emitter {
    connected = false
    constructor() {
      super()
      mpvFakes.socket = this
    }
    async connect(): Promise<void> {
      this.connected = true
    }
    async send(payload: { command: unknown[] }): Promise<unknown> {
      mpvFakes.sent.push(payload.command)
      return null
    }
    destroy(): void {
      this.connected = false
    }
  }
  return { MpvSocket, SOCKET_PATH: '/tmp/mpv-test.sock' }
})
vi.mock('../src/main/mpv-locate', () => ({ findMpvExecutable: () => 'mpv' }))
vi.mock('../src/main/plugins/host', () => ({
  registerPlugin: () => undefined,
}))
vi.mock('../src/main/plugins/process', () => ({
  killTree: async () => undefined,
  stopProcess: async () => undefined,
}))
vi.mock('child_process', async () => {
  const { EventEmitter: Emitter } = await import('events')
  return {
    spawn: () => Object.assign(new Emitter(), { pid: 1, kill: () => true }),
  }
})

describe('mpv 内核：缩小置顶', () => {
  beforeEach(() => {
    vi.resetModules()
    mpvFakes.sent.length = 0
  })

  const props = (): Array<[unknown, unknown]> =>
    mpvFakes.sent
      .filter(c => c[0] === 'set_property')
      .map(c => [c[1], c[2]] as [unknown, unknown])

  it('打开 → ontop + 缩到右下角；还原 → 取消置顶、回到初始尺寸；状态里带 compact', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.open({ url: 'https://a/b.m3u8' })
    mpvFakes.sent.length = 0
    await mpvPlayer.setCompact(true)
    expect(props()).toEqual([
      ['ontop', true],
      ['geometry', '480x270-24-24'],
    ])
    expect(mpvPlayer.getStatus().compact).toBe(true)
    mpvFakes.sent.length = 0
    await mpvPlayer.setCompact(false)
    expect(props()).toEqual([
      ['ontop', false],
      ['geometry', '1600x900+50%+50%'],
    ])
    expect(mpvPlayer.getStatus().compact).toBe(false)
  })

  it('小窗中换片：不做「一瞬间置顶」后取消置顶，保持置顶', async () => {
    vi.useFakeTimers()
    try {
      const { mpvPlayer } = await import('../src/main/mpv-player')
      await mpvPlayer.open({ url: 'https://a/1.m3u8' })
      await mpvPlayer.setCompact(true)
      mpvFakes.sent.length = 0
      await mpvPlayer.open({ url: 'https://a/2.m3u8' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(props()).not.toContainEqual(['ontop', false])
    } finally {
      vi.useRealTimers()
    }
  })

  it('没在运行时什么都不发；mpv 窗口里按 Alt+P（client-message）切换', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.setCompact(true)
    expect(mpvFakes.sent).toEqual([])
    await mpvPlayer.open({ url: 'https://a/b.m3u8' })
    expect(mpvFakes.sent).toContainEqual([
      'keybind',
      'Alt+p',
      'script-message yingbox-compact',
    ])
    mpvFakes.sent.length = 0
    mpvFakes.socket!.emit('event', {
      event: 'client-message',
      args: ['yingbox-compact'],
    })
    await vi.waitFor(() => expect(mpvPlayer.getStatus().compact).toBe(true))
  })

  it('契约：mpv.setCompact 只接受布尔值', async () => {
    const { mpv } = await import('../src/shared/contract/mpv')
    expect(mpv.calls.setCompact.parse([true])).toEqual([true])
    expect(() => mpv.calls.setCompact.parse(['1'])).toThrow()
  })
})
