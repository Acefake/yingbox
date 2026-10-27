import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * mpv 内核的「缩小置顶」（ontop + geometry）：mpv 不能画中画，这是它的替代，保住字幕 / 自动连播。
 */

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
  return { MpvSocket, nextSocketPath: () => '/tmp/mpv-test.sock' }
})
vi.mock('../src/main/mpv-locate', () => ({
  findMpvExecutable: () => 'mpv',
  ensureMpvExecutable: async () => 'mpv',
}))
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
