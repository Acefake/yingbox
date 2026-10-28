/**
 * mpv 生命周期：换片时续播位置走 start 选项（不在文件加载前设 time-pos）、属性设不上照样换片、
 * 旧进程迟到的 exit 不清掉新进程、每个进程独立 IPC 地址、启动失败不留孤儿进程、连点时被取代的 open 不报错、
 * 连接断开 / destroy 时等着的请求立即失败、destroy 能取消进行中的连接。
 */
import { EventEmitter } from 'events'
import { mkdtemp, rm } from 'node:fs/promises'
import { type Server, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Connect = (path: string, gone: () => boolean) => Promise<void>

const fakes = vi.hoisted(() => ({
  sent: [] as unknown[][],
  children: [] as Array<EventEmitter & { pid: number; args: string[] }>,
  killed: [] as number[],
  connect: null as null | Connect,
  failProps: [] as string[],
  socket: null as null | (EventEmitter & { connected: boolean }),
  userData: '',
}))

describe('mpv 播放器进程', () => {
  beforeEach(() => {
    vi.resetModules()
    fakes.sent.length = 0
    fakes.children.length = 0
    fakes.killed.length = 0
    fakes.connect = null
    fakes.failProps = []
    vi.doMock('../src/main/mpv-socket', async () => {
      const { EventEmitter: Emitter } = await import('events')
      class MpvSocket extends Emitter {
        connected = false
        constructor() {
          super()
          fakes.socket = this
        }
        async connect(
          path: string,
          _retries: number | undefined,
          gone: () => boolean
        ): Promise<void> {
          if (fakes.connect) await fakes.connect(path, gone)
          this.connected = true
        }
        async send(payload: { command: unknown[] }): Promise<unknown> {
          fakes.sent.push(payload.command)
          const [cmd, name] = payload.command
          if (cmd === 'set_property' && fakes.failProps.includes(String(name)))
            throw new Error('property unavailable')
          return null
        }
        destroy(): void {
          this.connected = false
        }
      }
      let n = 0
      return { MpvSocket, nextSocketPath: () => `/tmp/mpv-test-${++n}.sock` }
    })
    vi.doMock('../src/main/mpv-locate', () => ({
      findMpvExecutable: () => 'mpv',
      ensureMpvExecutable: async () => 'mpv',
    }))
    vi.doMock('../src/main/plugins/host', () => ({
      registerPlugin: () => undefined,
    }))
    vi.doMock('../src/main/plugins/process', () => ({
      killTree: async (child: { pid: number }) => {
        fakes.killed.push(child.pid)
      },
      stopProcess: async () => undefined,
    }))
    vi.doMock('child_process', async () => {
      const { EventEmitter: Emitter } = await import('events')
      return {
        spawn: (_exe: string, args: string[]) => {
          const child = Object.assign(new Emitter(), {
            pid: fakes.children.length + 1,
            args,
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

  it('高质量缩放支持启动、即时切换和进程重启', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.setHighQualityScaling(true)
    await mpvPlayer.open({ url: 'https://a/1.mp4' })
    expect(fakes.children[0].args).toContain('--scale=ewa_lanczossharp')
    await mpvPlayer.setHighQualityScaling(false)
    expect(fakes.sent).toContainEqual(['set_property', 'scale', 'lanczos'])
    await mpvPlayer.setHighQualityScaling(true)
    expect(fakes.sent).toContainEqual([
      'set_property',
      'scale',
      'ewa_lanczossharp',
    ])
    fakes.children[0].emit('exit')
    await mpvPlayer.open({ url: 'https://a/2.mp4' })
    expect(fakes.children[1].args).toContain('--scale=ewa_lanczossharp')
    await mpvPlayer.setHighQualityScaling(false)
    fakes.children[1].emit('exit')
    await mpvPlayer.open({ url: 'https://a/3.mp4' })
    expect(fakes.children[2].args).toContain('--scale=lanczos')
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

  it('换片前属性设不上（旧版 mpv）：只记日志，照样 loadfile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.open({ url: 'https://a/1.m3u8' })
    fakes.failProps = ['start', 'title']
    await expect(
      mpvPlayer.open({ url: 'https://a/2.m3u8', startAt: 5 })
    ).resolves.toBeUndefined()
    expect(fakes.sent).toContainEqual([
      'loadfile',
      'https://a/2.m3u8',
      'replace',
    ])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('新进程命令行：每个进程独立 IPC 地址，带上 start / title / sub-file / referrer', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    await mpvPlayer.open({
      url: 'https://a/1.m3u8|Referer=https%3A%2F%2Fr.example.com%2F',
      startAt: 300,
      title: '第一集',
      subFile: '/s/1.srt',
    })
    const args = fakes.children[0].args
    expect(args).toEqual(
      expect.arrayContaining([
        '--input-ipc-server=/tmp/mpv-test-1.sock',
        '--start=300',
        '--title=第一集',
        '--sub-file=/s/1.srt',
        '--referrer=https://r.example.com/',
      ])
    )
    expect(args.at(-1)).toBe('https://a/1.m3u8')
    fakes.socket!.connected = false
    await mpvPlayer.open({ url: 'https://a/2.m3u8' })
    expect(fakes.children[1].args).toContain(
      '--input-ipc-server=/tmp/mpv-test-2.sock'
    )
    // 旧进程先被杀掉，再起新进程
    expect(fakes.killed).toEqual([1])
  })

  it('启动失败（找不到 mpv）：open 很快失败、报出原因，状态回到没在运行', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    mpvPlayer.on('error', () => {})
    fakes.connect = async (_path, gone) => {
      fakes.children[0].emit('error', new Error('spawn mpv ENOENT'))
      if (gone()) throw new Error('mpv 进程已退出')
    }
    await expect(mpvPlayer.open({ url: 'https://a/1.m3u8' })).rejects.toThrow(
      'mpv 启动失败: spawn mpv ENOENT'
    )
    expect(mpvPlayer.getStatus().running).toBe(false)
  })

  it('进程起来了但 IPC 连不上：杀掉进程，不留孤儿', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    fakes.connect = async () => {
      throw new Error('mpv IPC 连接超时，请确认 mpv 已正常启动')
    }
    await expect(mpvPlayer.open({ url: 'https://a/1.m3u8' })).rejects.toThrow(
      'IPC 连接超时'
    )
    expect(fakes.killed).toEqual([1])
    expect(mpvPlayer.getStatus().running).toBe(false)
  })

  it('连点两次：按顺序执行，第一次失败但已被第二次取代时不报错', async () => {
    const { mpvPlayer } = await import('../src/main/mpv-player')
    let calls = 0
    fakes.connect = async () => {
      if (++calls === 1) throw new Error('mpv 进程已退出')
    }
    const first = mpvPlayer.open({ url: 'https://a/1.m3u8' })
    const second = mpvPlayer.open({ url: 'https://a/2.m3u8' })
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(fakes.children).toHaveLength(2)
    expect(mpvPlayer.getStatus().running).toBe(true)
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
  /** 测试专用 IPC 地址：Windows 用带进程号的唯一管道名，不碰真实 mpv 的管道 */
  const testPath = (): string =>
    process.platform === 'win32'
      ? `\\\\.\\pipe\\yb-mpv-test-${process.pid}-${Date.now()}`
      : join(fakes.userData, 'mpv-test.sock')
  const listen = async (path: string): Promise<void> => {
    server = createServer(conn => conn.on('data', () => {}))
    await new Promise<void>(r => server!.listen(path, r))
  }
  const until = async (ok: () => boolean, ms = 2000): Promise<void> => {
    const end = Date.now() + ms
    while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 10))
  }
  beforeEach(async () => {
    vi.resetModules()
    fakes.userData = await mkdtemp(join(tmpdir(), 'yb-mpv-'))
    vi.doMock('electron', () => ({
      app: { getPath: () => fakes.userData },
    }))
  })
  afterEach(async () => {
    if (server) await new Promise(r => server!.close(r))
    server = null
    await rm(fakes.userData, { recursive: true, force: true })
  })

  it('destroy 时等着的请求立即失败；之后能重新连上，旧连接的 close 不影响新连接', async () => {
    const { MpvSocket } = await import('../src/main/mpv-socket')
    const path = testPath()
    await listen(path)
    const sock = new MpvSocket()
    await sock.connect(path, 5)
    const pending = sock.send({ command: ['get_property', 'pause'] })
    const started = Date.now()
    sock.destroy()
    await expect(pending).rejects.toThrow('mpv 连接已断开')
    expect(Date.now() - started).toBeLessThan(1000)
    await sock.connect(path, 5)
    // 旧连接的 close 是异步到的：轮询等一会儿，确认新连接一直在
    await until(() => !sock.connected, 200)
    expect(sock.connected).toBe(true)
    sock.destroy()
  })

  it('connect 途中 destroy：进行中的连接作废，不会在 destroy 之后连上', async () => {
    const { MpvSocket } = await import('../src/main/mpv-socket')
    const path = testPath()
    await listen(path)
    const sock = new MpvSocket()
    const connecting = sock.connect(path, 5)
    sock.destroy()
    await expect(connecting).rejects.toThrow('已取消')
    await new Promise(r => setTimeout(r, 300))
    expect(sock.connected).toBe(false)
  })

  it('进程已经没了：不等满重试次数', async () => {
    const { MpvSocket } = await import('../src/main/mpv-socket')
    const sock = new MpvSocket()
    const started = Date.now()
    await expect(sock.connect(testPath(), 30, () => true)).rejects.toThrow(
      '已退出'
    )
    // 第一轮（200ms 间隔）就放弃，不等满 30 次重试（6 秒）
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
