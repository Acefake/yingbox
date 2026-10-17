import { app } from 'electron'
import { type ChildProcess, execFileSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { MpvSocket, SOCKET_PATH } from './mpv-socket'
import type { MpvOpenOptions, MpvPlaylistEntry, MpvStatus, MpvTrack } from '../shared/mpv'

const DEFAULT_STATUS: MpvStatus = {
  running: false, paused: true, volume: 100, muted: false,
  speed: 1, tracks: [], playlist: [], playlistPos: 0,
}

/** 需要持续观察的 mpv 属性（按索引注册，从 1 开始） */
const WATCH_PROPS = [
  'time-pos', 'duration', 'pause', 'volume', 'mute',
  'speed', 'track-list', 'media-title', 'path', 'playlist', 'playlist-pos',
  'video-params',
]

/** RTX 视频超分：仅对低于该高度（1080p）的片源自动挂载 */
const VSR_HEIGHT_LIMIT = 1080
/** 超分倍率（交给 NVIDIA 视频处理器放大的倍数） */
const VSR_SCALE = 2
/** NVIDIA RTX 视频超分滤镜（mpv 0.39+ 的 d3d11vpp，scale 必须 >1 才会真正超分） */
const VSR_FILTER = `d3d11vpp=scale=${VSR_SCALE}:scaling-mode=nvidia`
/** VSR 生效后在播放窗口显示「片源 → 超分后分辨率」的时长 */
const VSR_OSD_MS = 4500
/** 新播放时窗口「一瞬间置顶」的时长，之后自动取消置顶 */
const ONTOP_FLASH_MS = 1000

/** 随包/随项目附带的 mpv 可执行文件候选路径 */
function bundledMpvPaths(): string[] {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  return [
    // 打包后：electron-builder extraResources 把 resources/mpv 放到 resourcesPath/mpv
    typeof process.resourcesPath === 'string'
      ? join(process.resourcesPath, 'mpv', exe)
      : '',
    // 开发运行：项目内的 resources/mpv（与 amane 运行时同一套约定）
    join(app.getAppPath(), 'resources', 'mpv', exe),
  ].filter(Boolean)
}

/** 查找系统中的 mpv 可执行文件 */
function findMpvExecutable(): string {
  if (process.env.YINGBOX_MPV_PATH && existsSync(process.env.YINGBOX_MPV_PATH)) {
    return process.env.YINGBOX_MPV_PATH
  }
  const bundled = bundledMpvPaths().find(p => existsSync(p))
  if (bundled) return bundled

  const candidates = process.platform === 'win32'
    ? ['mpv.exe']
    : ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv', 'mpv']

  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { timeout: 2000, stdio: 'pipe' }); return c } catch { /* next */ }
  }
  throw new Error(
    '未找到 mpv 播放器。影盒会附带便携版 mpv（resources/mpv），' +
    '若缺失可执行 pnpm fetch:mpv 重新准备，或自行安装：\n' +
    'Windows: https://mpv.io/installation/\n' +
    'macOS: brew install mpv\n' +
    'Linux: sudo apt install mpv\n\n' +
    '也可通过环境变量 YINGBOX_MPV_PATH 指定可执行文件路径。'
  )
}

/**
 * mpv 播放器进程管理器。
 * 封装进程生命周期与 IPC 控制，以 EventEmitter 形式暴露状态变化。
 * 外部通过 `mpvPlayer` 单例访问。
 */
export class MpvPlayer extends EventEmitter {
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
  /** 「一瞬间置顶」的还原定时器 */
  private ontopTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    super()
    this.sock.on('event', (msg: Record<string, unknown>) => this.onEvent(msg))
    this.sock.on('close', () => this.onSocketClose())
    app.on('before-quit', () => this.quit())
  }

  /** 打开媒体。若 mpv 已在运行则替换当前文件，否则启动新进程 */
  async open(options: MpvOpenOptions): Promise<void> {
    const target = options.filePath || options.url
    if (!target) throw new Error('mpv: 必须指定 filePath 或 url')

    this._status = { ...this._status, loading: true, title: options.title, position: undefined }
    this.emit('status', this.getStatus())
    try {
      if (this.child && this.sock.connected) {
        await this.cmd('loadfile', target, 'replace')
        if (typeof options.startAt === 'number') await this.setProp('time-pos', options.startAt)
        if (options.subFile) await this.cmd('sub-add', options.subFile, 'select')
        await this.bringToFront()
      } else {
        await this.spawnProcess(options)
      }
    } catch (error) {
      this._status.loading = false
      this.emit('status', this.getStatus())
      throw error
    }
  }

  /**
   * 把 mpv 窗口提到最前（每次新播放时调用）。
   * 用「一瞬间置顶」实现：取消最小化 → 置顶把窗口顶到最前 → 短暂延时后
   * 自动取消置顶，避免播放窗口一直压在其他窗口上面。
   */
  private async bringToFront(): Promise<void> {
    try {
      await this.setProp('window-minimized', false)
      await this.setProp('ontop', false)
      await this.setProp('ontop', true)
      if (this.ontopTimer) clearTimeout(this.ontopTimer)
      this.ontopTimer = setTimeout(() => {
        this.ontopTimer = null
        void this.setProp('ontop', false).catch(() => {
          // 还原置顶失败不影响播放
        })
      }, ONTOP_FLASH_MS)
    } catch {
      // 置顶失败不应影响播放
    }
  }

  private async spawnProcess(options: MpvOpenOptions): Promise<void> {
    this.child?.kill()
    const exe = findMpvExecutable()
    const target = options.filePath || options.url!

    const args: string[] = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--force-window=yes', '--keep-open=yes',
      '--osc=yes', '--no-terminal', '--ytdl=no',
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
    if (typeof options.startAt === 'number') args.push(`--start=${options.startAt}`)
    if (options.title) args.push(`--title=${options.title}`)
    if (options.subFile) args.push(`--sub-file=${options.subFile}`)
    args.push(target)

    this.child = spawn(exe, args, { stdio: 'ignore', windowsHide: false })
    this.child.once('error', e => {
      this.emit('error', `mpv 启动失败: ${e.message}`)
      this.cleanupProcess()
    })
    this.child.once('exit', () => this.cleanupProcess())

    await this.sock.connect()
    this._status = {
      ...DEFAULT_STATUS, running: true, loading: true,
      path: target, title: options.title, paused: false,
    }
    for (let i = 0; i < WATCH_PROPS.length; i++) {
      await this.sock.send({ command: ['observe_property', i + 1, WATCH_PROPS[i]] })
    }
    this.emit('status', this.getStatus())
  }

  private onEvent(msg: Record<string, unknown>): void {
    if (msg.event === 'property-change') this.applyProp(msg.name as string, msg.data)
    else if (msg.event === 'end-file') {
      this._status.loading = false
      this.emit('status', this.getStatus())
      this.emit('end-file', msg.reason)
    } else if (msg.event === 'start-file') {
      this._status.loading = true
      this.emit('status', this.getStatus())
      this.emit('start-file')
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
      case 'duration': this._status.duration = typeof data === 'number' ? data : undefined; break
      case 'pause': this._status.paused = Boolean(data); break
      case 'volume': this._status.volume = typeof data === 'number' ? data : 100; break
      case 'mute': this._status.muted = Boolean(data); break
      case 'speed': this._status.speed = typeof data === 'number' ? data : 1; break
      case 'media-title': this._status.title = typeof data === 'string' ? data : undefined; break
      case 'path': this._status.path = typeof data === 'string' ? data : undefined; break
      case 'playlist-pos': this._status.playlistPos = typeof data === 'number' ? data : 0; break
      case 'track-list': this._status.tracks = this.parseTracks(data as Record<string, unknown>[]); break
      case 'playlist': this._status.playlist = this.parsePlaylist(data as Record<string, unknown>[]); break
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

  /** 设置 RTX 视频超分开关（来自渲染层的「设置 → 播放器」）。 */
  async setVsrEnabled(enabled: boolean): Promise<void> {
    if (this.vsrEnabled === enabled) return
    this.vsrEnabled = enabled
    await this.syncVsr()
  }

  private parseTracks(raw: Record<string, unknown>[]): MpvTrack[] {
    if (!Array.isArray(raw)) return []
    return raw.map(t => ({
      id: t.id as number, type: t.type as MpvTrack['type'],
      title: t.title as string | undefined, lang: t.lang as string | undefined,
      selected: Boolean(t.selected), codec: t.codec as string | undefined,
      forced: Boolean(t.forced), default: Boolean(t.default),
      externalFilename: t['external-filename'] as string | undefined,
    }))
  }

  private parsePlaylist(raw: Record<string, unknown>[]): MpvPlaylistEntry[] {
    if (!Array.isArray(raw)) return []
    return raw.map(p => ({ url: p.filename as string | undefined, name: p.title as string | undefined }))
  }

  private onSocketClose(): void {
    if (this.child) {
      this._status = { ...DEFAULT_STATUS }
      this.emit('status', this.getStatus())
    }
  }

  private cleanupProcess(): void {
    if (this.ontopTimer) {
      clearTimeout(this.ontopTimer)
      this.ontopTimer = null
    }
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
  async pause(paused: boolean): Promise<void> { await this.setProp('pause', paused) }
  async seek(seconds: number, mode: 'absolute' | 'relative' = 'absolute'): Promise<void> {
    await this.cmd('seek', seconds, mode)
  }
  async setVolume(vol: number): Promise<void> { await this.setProp('volume', Math.max(0, Math.min(200, vol))) }
  async setMute(muted: boolean): Promise<void> { await this.setProp('mute', muted) }
  async setSpeed(speed: number): Promise<void> { await this.setProp('speed', speed) }

  // ——— 轨道控制 ———
  async setSubTrack(id: number | false): Promise<void> { await this.setProp('sid', id === false ? 'no' : id) }
  async setAudioTrack(id: number): Promise<void> { await this.setProp('aid', id) }
  async addSubFile(filePath: string): Promise<void> { await this.cmd('sub-add', filePath, 'select') }

  // ——— 播放列表 ———
  async playlistNext(): Promise<void> { await this.cmd('playlist-next') }
  async playlistPrev(): Promise<void> { await this.cmd('playlist-prev') }
  async playlistPlay(index: number): Promise<void> { await this.cmd('playlist-play-index', index) }

  /** 退出 mpv（优先发 quit 命令，超时则 kill） */
  quit(): void {
    if (!this.child) return
    this.cmd('quit').catch(() => this.child?.kill())
  }
}

/** 全局单例 */
export const mpvPlayer = new MpvPlayer()
