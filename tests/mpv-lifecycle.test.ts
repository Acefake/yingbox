/**
 * mpv 生命周期：换片时续播位置走 start 选项（不在文件加载前设 time-pos）、旧进程迟到的 exit 不清掉新进程、
 * 连接断开 / destroy 时等着的请求立即失败。
 */
import { EventEmitter } from 'events'
import { mkdtemp, rm } from 'node:fs/promises'
import { type Server, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({
  sent: [] as unknown[][],
  children: [] as Array<EventEmitter & { pid: number }>,
  socket: null as null | (EventEmitter & { connected: boolean }),
  userData: '',
}))

describe('mpv 播放器进程', () => {
  beforeEach(() => {
    vi.resetModules()
    fakes.sent.length = 0
    fakes.children.length = 0
    vi.doMock('../src/main/mpv-socket', async () => {
      const { EventEmitter: Emitter } = await import('events')
      class MpvSocket extends Emitter {
        connected = false
        constructor() {
          super()
          fakes.socket = this
        }
        async connect(): Promise<void> {
          this.connected = true
        }
        async send(payload: { command: unknown[] }): Promise<unknown> {
          fakes.sent.push(payload.command)
          return null
        }
        destroy(): void {
          this.connected = false
        }
      }
      return { MpvSocket, SOCKET_PATH: '/tmp/mpv-test.sock' }
    })
    vi.doMock('../src/main/mpv-locate', () => ({
      findMpvExecutable: () => 'mpv',
    }))
    vi.doMock('../src/main/plugins/host', () => ({
      registerPlugin: () => undefined,
    }))
    vi.doMock('../src/main/plugins/process', () => ({
      killTree: async () => undefined,
      stopProcess: async () => undefined,
    }))
    vi.doMock('child_process', async () => {
      const { EventEmitter: Emitter } = await import('events')
      return {
        spawn: () => {
          const child = Object.assign(new Emitter(), {
            pid: fakes.children.length + 1,
            kill: () => true,
          })
          fakes.children.push(child)
          return child
        },
      }
    })
  })
  afterEach(() => {
    vi.doUnmock('../src/main/mpv-socket')
  })

  it('已在运行时换片：先设 start / title 再 loadfile，不在加载前设 time-pos', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.open({ url: 'https://a/1.m3u8', startAt: 300 })
    fakes.sent.length = 0
    await mpvPlayer.open({
      url: 'https://a/2.m3u8',
      title: '第二集',
      startAt: 42,
    })
    const load = fakes.sent.findIndex(c => c[0] === 'loadfile')
    expect(fakes.sent.slice(0, load)).toEqual([
      ['set_property', 'start', '42'],
      ['set_property', 'title', '第二集'],
    ])
    expect(fakes.sent).not.toContainEqual(['set_property', 'time-pos', 42])
    // 没给位置：清掉上一次的 --start
    fakes.sent.length = 0
    await mpvPlayer.open({ url: 'https://a/live.m3u8' })
    expect(fakes.sent).toContainEqual(['set_property', 'start', 'none'])
  })

  it('连接断了重开进程：旧进程迟到的 exit 不会清掉新进程', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.open({ url: 'https://a/1.m3u8' })
    fakes.socket!.connected = false
    await mpvPlayer.open({ url: 'https://a/2.m3u8' })
    expect(fakes.children).toHaveLength(2)
    fakes.children[0].emit('exit', 0)
    expect(mpvPlayer.getStatus().running).toBe(true)
    fakes.children[1].emit('exit', 0)
    expect(mpvPlayer.getStatus().running).toBe(false)
  })
})

describe('MpvSocket', () => {
  let server: Server | null = null
  beforeEach(async () => {
    vi.resetModules()
    fakes.userData = await mkdtemp(join(tmpdir(), 'yb-mpv-'))
    vi.doMock('electron', () => ({
      app: { getPath: () => fakes.userData },
    }))
  })
  afterEach(async () => {
    server?.close()
    server = null
    await rm(fakes.userData, { recursive: true, force: true })
  })

  it('destroy 时等着的请求立即失败；之后能重新连上，旧连接的 close 不影响新连接', async () => {
    const { MpvSocket, SOCKET_PATH } = await import('../src/main/mpv-socket')
    server = createServer(conn => conn.on('data', () => {}))
    await new Promise<void>(r => server!.listen(SOCKET_PATH, r))
    const sock = new MpvSocket()
    await sock.connect(5)
    const pending = sock.send({ command: ['get_property', 'pause'] })
    const started = Date.now()
    sock.destroy()
    await expect(pending).rejects.toThrow('mpv 连接已断开')
    expect(Date.now() - started).toBeLessThan(1000)
    await sock.connect(5)
    await new Promise(r => setTimeout(r, 50))
    expect(sock.connected).toBe(true)
    sock.destroy()
  })

  it('进程已经没了：不等满重试次数', async () => {
    const { MpvSocket } = await import('../src/main/mpv-socket')
    const sock = new MpvSocket()
    await expect(sock.connect(30, () => true)).rejects.toThrow('已退出')
  })
})
