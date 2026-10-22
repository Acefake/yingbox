import { type ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { findMpvExecutable } from './mpv-locate'
import {
  COMPACT_KEY,
  COMPACT_MESSAGE,
  DEFAULT_STATUS,
  WATCH_PROPS,
  parsePlaylist,
  parseTracks,
} from './mpv-props'
import { MpvSocket, SOCKET_PATH } from './mpv-socket'
import { MpvWindow } from './mpv-window'
import { refererFor } from './media-headers'
import { registerPlugin } from './plugins/host'
import { killTree, stopProcess } from './plugins/process'
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
        await this.cmd('loadfile', target, 'replace')
        if (typeof options.startAt === 'number')
          await this.setProp('time-pos', options.startAt)
        if (options.subFile)
          await this.cmd('sub-add', options.subFile, 'select')
        await this.window.bringToFront()
      } else {
        await this.spawnProcess(options)
      }
    } catch (error) {
      this._status.loading = false
      this.emit('status', this.getStatus())
      throw error
    }
  }

  private async spawnProcess(options: MpvOpenOptions): Promise<void> {
    if (this.child) void killTree(this.child)
    const exe = findMpvExecutable()
    const target = options.filePath || options.url!

    const args: string[] = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--force-window=yes',
      '--keep-open=yes',
      '--osc=yes',
      '--no-terminal',
      '--ytdl=no',
      // 无边框：不显示 Windows 标题栏及其英文系统菜单，菜单改由影盒提供。
      // --window-dragging 默认 yes，无边框时仍可用鼠标拖动窗口。
      '--border=no',
      // 首次打开（新进程）时的初始窗口尺寸；之后由用户自己调整并保持。
      '--geometry=1600x900',
    ]
    if (this.isVsrWanted()) {
      // RTX 视频超分依赖 d3d11vpp 滤镜，必须走 D3D11 的 GPU API；
      // 同时固定 D3D11 硬解，让帧停留在 GPU 上。
      args.push('--gpu-api=d3d11', '--hwdec=d3d11va')
    }
    if (typeof options.startAt === 'number')
      args.push(`--start=${options.startAt}`)
    if (options.title) args.push(`--title=${options.title}`)
    if (options.subFile) args.push(`--sub-file=${options.subFile}`)
    // 防盗链 CDN（MissAV）：mpv 不经 Chromium 会话，Referer 要自己带
    const referer = options.url ? refererFor(options.url) : undefined
    if (referer) args.push(`--referrer=${referer}`)
    args.push(target)

    this.child = spawn(exe, args, { stdio: 'ignore', windowsHide: false })
    this.child.once('error', e => {
      this.emit('error', `mpv 启动失败: ${e.message}`)
      this.cleanupProcess()
    })
    this.child.once('exit', () => this.cleanupProcess())

    await this.sock.connect()
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
    switch (name) {
      case 'time-pos':
        this._status.position = typeof data === 'number' ? data : undefined
        // 启动时可能在 IPC 连接前已经就绪；有效播放位置可补齐该状态。
        if (typeof data === 'number') this._status.loading = false
        break
      case 'duration':
        this._status.duration = typeof data === 'number' ? data : undefined
        break
      case 'pause':
        this._status.paused = Boolean(data)
        break
      case 'volume':
        this._status.volume = typeof data === 'number' ? data : 100
        break
      case 'mute':
        this._status.muted = Boolean(data)
        break
      case 'speed':
        this._status.speed = typeof data === 'number' ? data : 1
        break
      case 'media-title':
        this._status.title = typeof data === 'string' ? data : undefined
        break
      case 'path':
        this._status.path = typeof data === 'string' ? data : undefined
        break
      case 'playlist-pos':
        this._status.playlistPos = typeof data === 'number' ? data : 0
        break
      case 'track-list':
        this._status.tracks = parseTracks(data as Record<string, unknown>[])
        break
      case 'playlist':
        this._status.playlist = parsePlaylist(data as Record<string, unknown>[])
        break
      case 'video-params': {
        const params = data as { h?: number; w?: number } | null
        this.videoHeight = typeof params?.h === 'number' ? params.h : 0
        this.videoWidth = typeof params?.w === 'number' ? params.w : 0
        void this.syncVsr()
        break
      }
    }
    this.emit('status', this.getStatus())
  }

  // ——— RTX 视频超分 ———

  /** 超分开关是否希望生效（功能依赖 D3D11，仅 Windows 平台） */
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

  private onSocketClose(): void {
    if (this.child) {
      this._status = { ...DEFAULT_STATUS }
      this.emit('status', this.getStatus())
    }
  }

  private cleanupProcess(): void {
    this.window.reset()
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

  // ——— 播放列表 ———

  /** 退出 mpv：先发 quit 命令，1.5 秒内没退出就强杀进程树；返回时进程已退出或已放弃等待。 */
  async quit(): Promise<void> {
    const child = this.child
    if (!child) return
    await stopProcess(child, { graceful: () => this.cmd('quit') })
  }
}

/** 全局单例 */
export const mpvPlayer = new MpvPlayer()
