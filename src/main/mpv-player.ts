import { type ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { Anime4kSync } from './mpv-anime4k'
import { findMpvExecutable } from './mpv-locate'
import {
  COMPACT_KEY,
  COMPACT_MESSAGE,
  DEFAULT_STATUS,
  WATCH_PROPS,
  patchStatus,
  replaceProps,
  spawnArgs,
} from './mpv-props'
import { MpvSocket, SOCKET_PATH } from './mpv-socket'
import { MpvHeaderState, mpvStream } from './mpv-stream'
import { MpvWindow } from './mpv-window'
import { registerPlugin } from './plugins/host'
import { killTree, stopProcess } from './plugins/process'
import type { Anime4kConfig } from '../shared/anime4k'
import type { MpvOpenOptions, MpvStatus } from '../shared/mpv'

/** RTX 视频超分：仅对低于该高度（1080p）的片源自动挂载 */
const VSR_HEIGHT_LIMIT = 1080
/** 超分倍率（交给 NVIDIA 视频处理器放大的倍数） */
const VSR_SCALE = 2
/** NVIDIA RTX 视频超分滤镜（mpv 0.39+ 的 d3d11vpp，scale 必须 >1 才会真正超分） */
const VSR_FILTER = `d3d11vpp=scale=${VSR_SCALE}:scaling-mode=nvidia`
/** VSR 生效后在播放窗口显示「片源 → 超分后分辨率」的时长 */
const VSR_OSD_MS = 4500

/**
 * mpv 播放器进程管理器。
 * 封装进程生命周期与 IPC 控制，以 EventEmitter 形式暴露状态变化。
 * 外部通过 `mpvPlayer` 单例访问。
 */
class MpvPlayer extends EventEmitter {
  private child: ChildProcess | null = null
  private readonly sock = new MpvSocket()
  private _status: MpvStatus = { ...DEFAULT_STATUS }
  /** RTX 视频超分开关（渲染层设置项，默认关闭） */
  private vsrEnabled = false
  /** 当前是否已挂上超分滤镜 */
  private vsrActive = false
  /** 当前片源高度（来自 mpv 的 video-params） */
  private videoHeight = 0
  /** 当前片源宽度（来自 mpv 的 video-params） */
  private videoWidth = 0
  /** VSR 正在跟随时给的 OSD 提示定时器 */
  private vsrOsdTimer: ReturnType<typeof setTimeout> | null = null
  /** 窗口置顶：新播放时顶到最前、缩小置顶 */
  private readonly window = new MpvWindow((name, value) =>
    this.setProp(name, value)
  )
  /** 本进程里影盒改过的 UA / Referer（换片时还原） */
  private readonly headers = new MpvHeaderState(
    name => this.cmd('get_property', name),
    (name, value) => this.setProp(name, value)
  )
  /** 影盒超分着色器（设置 + 当前条目是否动画） */
  private readonly anime4k = new Anime4kSync(
    (...args) => this.cmd(...args),
    () => Boolean(this.child) && this.sock.connected
  )

  constructor() {
    super()
    this.sock.on('event', (msg: Record<string, unknown>) => this.onEvent(msg))
    this.sock.on('close', () => this.onSocketClose())
    registerPlugin({
      id: 'mpv',
      stop: () => this.quit(),
      health: () => ({
        running: Boolean(this.child),
        detail: this._status.title,
      }),
    })
  }

  /** 打开媒体。若 mpv 已在运行则替换当前文件，否则启动新进程 */
  async open(options: MpvOpenOptions): Promise<void> {
    const target = options.filePath || options.url
    if (!target) throw new Error('mpv: 必须指定 filePath 或 url')

    this._status = {
      ...this._status,
      loading: true,
      title: options.title,
      position: undefined,
    }
    this.emit('status', this.getStatus())
    try {
      if (this.child && this.sock.connected) {
        const stream = mpvStream(options)
        await this.headers.apply(stream.headers)
        for (const [name, value] of replaceProps(options))
          await this.setProp(name, value)
        await this.cmd('loadfile', stream.target, 'replace')
        if (options.subFile)
          await this.cmd('sub-add', options.subFile, 'select')
        await this.window.bringToFront()
      } else {
        await this.spawnProcess(options)
      }
      void this.anime4k.apply(options.anime === true)
    } catch (error) {
      this._status.loading = false
      this.emit('status', this.getStatus())
      throw error
    }
  }

  private async spawnProcess(options: MpvOpenOptions): Promise<void> {
    // 旧进程还在但连接断了：先就地收尾再杀，它迟到的 exit 不会再清掉新进程
    const old = this.child
    if (old) {
      this.cleanupProcess()
      void killTree(old)
    }
    const exe = findMpvExecutable()
    const { target, headers } = mpvStream(options)
    const args = spawnArgs({
      socket: SOCKET_PATH,
      target,
      startAt: options.startAt,
      title: options.title,
      subFile: options.subFile,
      headers,
      vsr: this.isVsrWanted(),
    })
    this.headers.reset(headers)
    const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false })
    this.child = child
    let spawnError: Error | null = null
    child.once('error', e => {
      spawnError = e
      if (this.child !== child) return
      this.emit('error', `mpv 启动失败: ${e.message}`)
      this.cleanupProcess()
    })
    child.once('exit', () => {
      if (this.child === child) this.cleanupProcess()
    })
    try {
      await this.sock.connect(undefined, () => this.child !== child)
    } catch (error) {
      // 连不上：不留没人管的 mpv 进程
      if (this.child === child) {
        this.cleanupProcess()
        void killTree(child)
      }
      const failed = spawnError as Error | null
      throw failed ? new Error(`mpv 启动失败: ${failed.message}`) : error
    }
    this._status = {
      ...DEFAULT_STATUS,
      running: true,
      loading: true,
      path: target,
      title: options.title,
      paused: false,
    }
    for (let i = 0; i < WATCH_PROPS.length; i++) {
      await this.sock.send({
        command: ['observe_property', i + 1, WATCH_PROPS[i]],
      })
    }
    // mpv 窗口里按快捷键切换缩小置顶（mpv 不支持 keybind 命令时忽略）
    await this.sock
      .send({
        command: ['keybind', COMPACT_KEY, `script-message ${COMPACT_MESSAGE}`],
      })
      .catch(() => {})
    this.emit('status', this.getStatus())
  }

  private onEvent(msg: Record<string, unknown>): void {
    if (msg.event === 'property-change')
      this.applyProp(msg.name as string, msg.data)
    else if (msg.event === 'end-file') {
      this._status.loading = false
      this.emit('status', this.getStatus())
      this.emit('end-file', msg.reason)
    } else if (msg.event === 'start-file') {
      this._status.loading = true
      this.emit('status', this.getStatus())
      this.emit('start-file')
    } else if (
      msg.event === 'client-message' &&
      Array.isArray(msg.args) &&
      msg.args[0] === COMPACT_MESSAGE
    ) {
      void this.setCompact(!this.window.compact).catch(() => {})
    } else if (msg.event === 'playback-restart') {
      this._status.loading = false
      this.emit('status', this.getStatus())
    }
  }

  private applyProp(name: string, data: unknown): void {
    if (name === 'video-params') {
      const params = data as { h?: number; w?: number } | null
      this.videoHeight = typeof params?.h === 'number' ? params.h : 0
      this.videoWidth = typeof params?.w === 'number' ? params.w : 0
      void this.syncVsr()
    } else patchStatus(this._status, name, data)
    this.emit('status', this.getStatus())
  }

  /** RTX 视频超分开关是否希望生效（功能依赖 D3D11，仅 Windows 平台） */
  private isVsrWanted(): boolean {
    return this.vsrEnabled && process.platform === 'win32'
  }

  /**
   * 按当前片源同步超分滤镜：开关打开、mpv 在跑、片源高度低于 1080p 时挂载
   * `d3d11vpp=scaling-mode=nvidia`，否则保持空滤镜链。
   * 非 D3D11 路径或非 RTX 显卡时 mpv 会记录“Creating filter failed”并忽略，
   * 播放本身不受影响。
   */
  private async syncVsr(): Promise<void> {
    const want =
      this.isVsrWanted() &&
      Boolean(this.child) &&
      this.videoHeight > 0 &&
      this.videoHeight < VSR_HEIGHT_LIMIT
    if (want === this.vsrActive) return
    try {
      await this.cmd('vf', 'set', want ? VSR_FILTER : '')
      this.vsrActive = want
      if (want) this.scheduleVsrOsd()
    } catch {
      this.vsrActive = false
    }
    this.emit('status', this.getStatus())
  }

  /**
   * 超分生效后在播放窗口弹一条「片源 → 超分后分辨率」的提示。
   * 稍作延迟，等滤镜链重建完成后再显示，避免被 video-reconfig 冲掉。
   */
  private scheduleVsrOsd(): void {
    if (this.vsrOsdTimer) clearTimeout(this.vsrOsdTimer)
    this.vsrOsdTimer = setTimeout(() => {
      this.vsrOsdTimer = null
      if (!this.vsrActive) return
      const { videoWidth: w, videoHeight: h } = this
      if (w <= 0 || h <= 0) return
      const text = `${w}×${h} → ${w * VSR_SCALE}×${h * VSR_SCALE} · RTX 超分`
      void this.cmd('show-text', text, VSR_OSD_MS).catch(() => {
        // OSD 失败不影响播放
      })
    }, 700)
  }

  /**
   * 缩小置顶：mpv 窗口缩到屏幕右下角并保持在最前（mpv 是独立窗口，没有画中画）；on = false 还原。
   * mpv 没在运行时什么都不做。
   */
  async setCompact(on: boolean): Promise<void> {
    if (!this.child) return
    await this.window.setCompact(on)
    this.emit('status', this.getStatus())
  }

  /** 设置 RTX 视频超分开关（来自渲染层的「设置 → 播放器」）。 */
  async setVsrEnabled(enabled: boolean): Promise<void> {
    if (this.vsrEnabled === enabled) return
    this.vsrEnabled = enabled
    await this.syncVsr()
  }

  /** 设置影盒超分（来自渲染层的「设置 → 播放器」）。 */
  async setAnime4k(config: Anime4kConfig): Promise<void> {
    await this.anime4k.setConfig(config)
  }

  private onSocketClose(): void {
    if (this.child) {
      this._status = { ...DEFAULT_STATUS }
      this.emit('status', this.getStatus())
    }
  }

  private cleanupProcess(): void {
    this.window.reset()
    this.anime4k.reset()
    if (this.vsrOsdTimer) {
      clearTimeout(this.vsrOsdTimer)
      this.vsrOsdTimer = null
    }
    this.child = null
    this.sock.destroy()
    this.vsrActive = false
    this.videoWidth = 0
    this.videoHeight = 0
    this._status = { ...DEFAULT_STATUS }
    this.emit('status', this.getStatus())
    this.emit('exit')
  }

  getStatus(): MpvStatus {
    const w = this.videoWidth
    const h = this.videoHeight
    return {
      ...this._status,
      running: Boolean(this.child),
      compact: this.window.compact,
      vsr: this.vsrActive,
      videoWidth: w || undefined,
      videoHeight: h || undefined,
      vsrWidth: this.vsrActive && w ? w * VSR_SCALE : undefined,
      vsrHeight: this.vsrActive && h ? h * VSR_SCALE : undefined,
    }
  }

  private async cmd(...args: unknown[]): Promise<unknown> {
    return this.sock.send({ command: args })
  }
  private async setProp(name: string, value: unknown): Promise<void> {
    await this.sock.send({ command: ['set_property', name, value] })
  }

  // ——— 播放控制 ———
  async pause(paused: boolean): Promise<void> {
    await this.setProp('pause', paused)
  }
  async seek(
    seconds: number,
    mode: 'absolute' | 'relative' = 'absolute'
  ): Promise<void> {
    await this.cmd('seek', seconds, mode)
  }
  async setVolume(vol: number): Promise<void> {
    await this.setProp('volume', Math.max(0, Math.min(200, vol)))
  }
  async setMute(muted: boolean): Promise<void> {
    await this.setProp('mute', muted)
  }
  async setSpeed(speed: number): Promise<void> {
    await this.setProp('speed', speed)
  }

  // ——— 轨道控制 ———
  async setSubTrack(id: number | false): Promise<void> {
    await this.setProp('sid', id === false ? 'no' : id)
  }
  async setAudioTrack(id: number): Promise<void> {
    await this.setProp('aid', id)
  }
  async addSubFile(filePath: string): Promise<void> {
    await this.cmd('sub-add', filePath, 'select')
  }
  /** 画面上显示一行提示（OSD）；mpv 没在跑时不做 */
  async showText(text: string, ms: number): Promise<void> {
    if (this.child) await this.cmd('show-text', text, ms)
  }

  /** 退出 mpv：先发 quit 命令，1.5 秒内没退出就强杀进程树；返回时进程已退出或已放弃等待。 */
  async quit(): Promise<void> {
    const child = this.child
    if (!child) return
    await stopProcess(child, { graceful: () => this.cmd('quit') })
  }
}

/** 全局单例 */
export const mpvPlayer = new MpvPlayer()
