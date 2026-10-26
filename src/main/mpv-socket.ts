import { Socket, createConnection } from 'net'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { join } from 'path'

/** Windows 用命名管道，Unix 用本地 socket */
export const SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\yingbox-mpv'
    : join(app.getPath('userData'), 'mpv.sock')

interface PendingRequest {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * mpv JSON IPC 协议客户端。
 * 处理行缓冲、请求/响应配对、属性观察事件的分发。
 */
export class MpvSocket extends EventEmitter {
  private socket: Socket | null = null
  private lineBuffer = ''
  private requestId = 0
  private readonly pending = new Map<number, PendingRequest>()

  get connected(): boolean {
    return this.socket !== null
  }

  /**
   * 等待 mpv 启动并监听 socket，最多重试 retries 次（每次间隔 200ms）。
   * @param gone 进程已经没了（启动失败 / 退出）：不再等，直接失败
   */
  async connect(
    retries = 30,
    gone: () => boolean = () => false
  ): Promise<void> {
    for (let i = 0; i < retries; i++) {
      await sleep(200)
      if (gone()) throw new Error('mpv 进程已退出')
      try {
        await this.tryConnect()
        return
      } catch {
        if (i === retries - 1)
          throw new Error('mpv IPC 连接超时，请确认 mpv 已正常启动')
      }
    }
  }

  /**
   * 连一次。连上后的事件只认当前这条连接：destroy 之后旧连接迟到的 close / data 不会清掉新连接、
   * 不会让新连接上等着的请求失败。
   */
  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(SOCKET_PATH)
      sock.once('error', reject)
      sock.once('connect', () => {
        sock.removeListener('error', reject)
        this.socket = sock
        sock.setEncoding('utf8')
        sock.on('data', (chunk: string) => {
          if (this.socket === sock) this.onData(chunk)
        })
        // error 之后必有 close；常驻监听，避免第二个 error 成为未处理异常
        sock.on('error', () => {})
        sock.once('close', () => {
          if (this.socket === sock) this.onClose()
        })
        resolve()
      })
    })
  }

  /** 处理接收到的 socket 数据（行缓冲，防止消息被切割） */
  private onData(chunk: string): void {
    this.lineBuffer += chunk
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this.dispatch(JSON.parse(line) as Record<string, unknown>)
      } catch {
        /* 忽略非法 JSON */
      }
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    const reqId = msg.request_id as number | undefined
    if (reqId !== undefined) {
      const cb = this.pending.get(reqId)
      if (!cb) return
      clearTimeout(cb.timer)
      this.pending.delete(reqId)
      if (msg.error === 'success') cb.resolve(msg.data ?? null)
      else cb.reject(new Error(String(msg.error ?? '未知 mpv 错误')))
      return
    }
    if (msg.event) this.emit('event', msg)
  }

  private onClose(): void {
    this.socket = null
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('mpv 连接已断开'))
    }
    this.pending.clear()
    this.lineBuffer = ''
    this.emit('close')
  }

  /** 发送 JSON 命令，返回 mpv 响应的 data 字段 */
  send(payload: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('mpv 未连接'))
      const id = ++this.requestId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('mpv 命令超时'))
      }, 5000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.write(`${JSON.stringify({ ...payload, request_id: id })}\n`)
    })
  }

  /** 断开：等着的请求立即失败（不等 5 秒超时） */
  destroy(): void {
    const sock = this.socket
    if (!sock) return
    this.onClose()
    sock.destroy()
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
