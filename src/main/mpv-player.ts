import type { ChildProcess } from 'child_process'
import { MpvControls } from './mpv-controls'
import { type DiscSource, discSourceOf } from './mpv-disc'
import { ensureMpvExecutable, locateMpv } from './mpv-locate'
import { validateMpvLocalFile } from './mpv-local-file'
import {
  type EventHost,
  routeMpvEvent,
  warnEnhancement,
  warnProp,
} from './mpv-events'
import { DEFAULT_STATUS, replaceProps, spawnArgs } from './mpv-props'
import {
  handshakeMpv,
  launchMpv,
  launchSignature,
  prewarmEnabled,
} from './mpv-launch'
import { MpvSocket, nextSocketPath } from './mpv-socket'
import { MpvHeaderState, mpvStream } from './mpv-stream'
import { MpvWindow } from './mpv-window'
import { MpvEnhancement } from './mpv-enhancement'
import { MpvImageEnhance } from './mpv-enhance'
import { probeNvidiaGpu } from './mpv-gpu'
import { locateMpvUi } from './mpv-ui'
import { ensureMpvVsrHook } from './mpv-vsr-hook'
import { settingsStore } from './settings'
import { registerPlugin } from './plugins/host'
import { killTree, stopProcess } from './plugins/process'
import type { MpvOpenOptions, MpvStatus } from '../shared/mpv'

/**
 * mpv 播放器进程管理器。
 * 封装进程生命周期与 IPC 控制，以 EventEmitter 形式暴露状态变化。
 * 外部通过 `mpvPlayer` 单例访问。
 */
class MpvPlayer extends MpvControls {
  private child: ChildProcess | null = null
  private readonly sock = new MpvSocket()
  /** open 串行执行：连点 / 双击时第二次等第一次起完进程再换片，不会两个进程抢连接 */
  private opening: Promise<void> = Promise.resolve()
  /** 每次 open 加一：一次 open 失败时若已有更新的 open 排在后面，它就算被取代，不向上报错 */
  private openSeq = 0
  private _status: MpvStatus = { ...DEFAULT_STATUS }
  /** 有文件在放（窗口开着）。进程常驻待命时为 false，此时对外 running = false */
  private active = false
  /** 应用正在退出：进程退出后不再预热 */
  private quitting = false
  /** 已排队的预热：避免重复排队 */
  private warmPending = false
  /** 当前进程的启动签名：这些设置只能靠启动参数生效，变了就要重启待命进程 */
  private spawnSig = ''
  /** RTX 视频超分开关（渲染层设置项，默认关闭） */
  private vsrEnabled = false
  private readonly enhancement = new MpvEnhancement(
    (...args) => this.cmd(...args),
    () => {
      this.publishVsrLabel()
      this.emit('status', this.getStatus())
    },
    process.platform,
    probeNvidiaGpu
  )
  /** 已写给 mpv 的角标文字：没变就不再发命令 */
  private vsrLabel = ''
  /** 窗口置顶：新播放时顶到最前、缩小置顶 */
  private readonly window = new MpvWindow((name, value) =>
    this.setProp(name, value)
  )
  /** 本进程里影盒改过的 UA / Referer（换片时还原） */
  private readonly headers = new MpvHeaderState(
    name => this.cmd('get_property', name),
    (name, value) => this.setProp(name, value)
  )
  readonly imageEnhance = new MpvImageEnhance(
    (name, value) => this.setProp(name, value),
    () => Boolean(this.child) && this.sock.connected
  )

  /** 事件处理读写本类状态的入口（见 mpv-events.ts） */
  private readonly events: EventHost = {
    status: () => this._status,
    publish: () => this.emit('status', this.getStatus()),
    emit: (event, ...args) => this.emit(event, ...args),
    enhancement: this.enhancement,
    imageEnhance: this.imageEnhance,
    active: () => this.active,
    goIdle: () => this.goIdle(),
    bringToFront: () => this.window.bringToFront(),
    compact: () => this.window.compact,
    setCompact: on => this.setCompact(on),
    child: () => this.child,
    connected: () => this.sock.connected,
    cmd: (...args) => this.cmd(...args),
  }

  constructor() {
    super()
    this.sock.on('event', (msg: Record<string, unknown>) =>
      routeMpvEvent(this.events, msg)
    )
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

  /**
   * 打开媒体。若 mpv 已在运行则替换当前文件，否则启动新进程。
   * 多次调用按顺序执行；失败时已有更新的 open 在排队，这次算被取代，静默返回（以最后一次为准）。
   */
  open(options: MpvOpenOptions): Promise<void> {
    if (!options.filePath && !options.url)
      return Promise.reject(new Error('mpv: 必须指定 filePath 或 url'))
    const seq = ++this.openSeq
    this.quitting = false
    const run = this.opening.then(() =>
      this.openNow(options).catch((error: unknown) => {
        if (seq !== this.openSeq) return
        throw error
      })
    )
    this.opening = run.catch(() => {})
    return run
  }

  private async openNow(options: MpvOpenOptions): Promise<void> {
    this._status = {
      ...this._status,
      loading: true,
      title: options.title,
      position: undefined,
    }
    this.emit('status', this.getStatus())
    const wasActive = this.active
    try {
      await validateMpvLocalFile(options.filePath)
      const disc = await discSourceOf(options.filePath)
      // 待命进程的启动参数（超分、控制条）和现在的设置对不上，就丢掉重开
      const reusable =
        this.child &&
        this.sock.connected &&
        (this.active || this.spawnSig === launchSignature(this.isVsrWanted()))
      if (reusable) {
        await this.enhancement.prepareFile()
        const stream = mpvStream(options, disc)
        if (disc) await this.setProp(disc.option, disc.device).catch(warnProp)
        // 属性设不上（低版本 mpv 不认某个值等）只记日志，照样换片，不让整次 open 失败
        await this.headers.apply(stream.headers).catch(warnProp)
        for (const [name, value] of replaceProps(options))
          await this.setProp(name, value).catch(warnProp)
        this.active = true
        await this.cmd('loadfile', stream.target, 'replace')
        if (options.subFile)
          await this.cmd('sub-add', options.subFile, 'select')
        await this.window.bringToFront()
      } else {
        await this.spawnProcess(options, disc)
      }
    } catch (error) {
      this._status.loading = false
      if (!wasActive && this.active && this.child) this.goIdle()
      this.emit('status', this.getStatus())
      throw error
    }
  }

  /**
   * 后台起一个不带窗口的 mpv 待命：之后点播放只发 loadfile，省掉进程启动、脚本加载和 IPC 握手。
   * 没装 mpv 时什么都不做（不为预热去下载）；已有待命进程且启动参数还对得上就保持。
   */
  prewarm(): Promise<void> {
    if (this.warmPending || !prewarmEnabled(this.quitting) || !locateMpv())
      return Promise.resolve()
    this.warmPending = true
    this.opening = this.opening
      .then(async () => {
        this.warmPending = false
        if (!prewarmEnabled(this.quitting)) return
        const parked = this.child && this.sock.connected
        if (
          parked &&
          (this.active || this.spawnSig === launchSignature(this.isVsrWanted()))
        )
          return
        await this.spawnProcess(null, null)
      })
      .catch((error: unknown) => {
        this.warmPending = false
        console.warn('[mpv] 预热失败：', error)
      })
    return this.opening
  }

  /**
   * 按设置让待命进程与现状一致：该有就预热（或因启动参数过期重开），不该有就退出；
   * 应用启动、相关设置变化、超分开关变化时调用。
   */
  async syncPrewarm(): Promise<void> {
    if (prewarmEnabled(this.quitting)) await this.prewarm()
    else if (this.child && !this.active) await this.terminate()
  }

  /** 播放结束 / 窗口关了：回到待命（窗口随 force-window=no 消失），没开预热就直接退出进程 */
  private goIdle(): void {
    this.active = false
    if (this.window.compact) void this.window.setCompact(false).catch(() => {})
    this.window.reset()
    this._status = { ...DEFAULT_STATUS }
    this.emit('status', this.getStatus())
    this.emit('exit')
    if (!prewarmEnabled(this.quitting)) void this.terminate()
  }

  private async spawnProcess(
    options: MpvOpenOptions | null,
    disc: DiscSource | null
  ): Promise<void> {
    // 旧进程还在但连接断了：先就地收尾，等它被杀掉再起新进程；它迟到的 exit 不会再清掉新进程
    const old = this.child
    if (old) {
      this.cleanupProcess()
      await killTree(old)
    }
    const socket = nextSocketPath()
    // Windows 上找不到会先自动下载便携版（期间推 installing 事件给渲染层提示）
    const exe = await ensureMpvExecutable(on => this.emit('installing', on))
    const { target, headers } = options
      ? mpvStream(options, disc)
      : { target: undefined, headers: {} }
    const hookScript = await ensureMpvVsrHook()
    const args = spawnArgs({
      socket,
      target,
      startAt: options?.startAt,
      title: options?.title,
      subFile: options?.subFile,
      headers,
      vsr: this.isVsrWanted(),
      highQualityScaling: this.imageEnhance.highQuality,
      disc,
      hookScript,
      ui: locateMpvUi(settingsStore().get('player.mpvUi')),
    })
    this.headers.reset(headers)
    this.active = Boolean(options)
    this._status = options
      ? {
          ...DEFAULT_STATUS,
          running: true,
          loading: true,
          path: target,
          title: options.title,
          paused: false,
        }
      : { ...DEFAULT_STATUS }
    await launchMpv(
      {
        sock: this.sock,
        current: () => this.child,
        adopt: child => {
          this.child = child
          this.spawnSig = launchSignature(this.isVsrWanted())
        },
        onError: message => {
          this.emit('error', message)
          this.cleanupProcess()
        },
        onExit: livedMs => {
          this.cleanupProcess()
          // 意外退出后补一个待命进程；刚起就退出说明起不来，不循环重试
          if (livedMs > 3000) setTimeout(() => void this.prewarm(), 500)
        },
        cleanup: () => this.cleanupProcess(),
      },
      exe,
      args,
      socket
    )
    await handshakeMpv({
      sock: this.sock,
      hookScript,
      cmd: (...a) => this.cmd(...a),
      setProp: (name, value) => this.setProp(name, value),
      enhancement: this.enhancement,
      imageEnhance: this.imageEnhance,
      onWarn: warnProp,
    })
    this.emit('status', this.getStatus())
  }

  /** RTX 视频超分开关是否希望生效（功能依赖 D3D11，仅 Windows 平台） */
  private isVsrWanted(): boolean {
    return this.vsrEnabled && process.platform === 'win32'
  }

  /**
   * 缩小置顶：mpv 窗口缩到屏幕右下角并保持在最前（mpv 是独立窗口，没有画中画）；on = false 还原。
   * mpv 没在运行时什么都不做。
   */
  async setCompact(on: boolean): Promise<void> {
    if (!this.child || !this.active) return
    await this.window.setCompact(on)
    this.emit('status', this.getStatus())
  }

  /** 设置 RTX 视频超分开关（来自渲染层的「设置 → 播放器」）。 */
  async setVsrEnabled(enabled: boolean): Promise<void> {
    if (this.vsrEnabled === enabled) return
    this.vsrEnabled = enabled
    await this.enhancement.setEnabled(enabled)
    void this.syncPrewarm().catch(warnEnhancement)
  }

  private onSocketClose(): void {
    if (this.child) {
      this.enhancement.disconnect()
      this.vsrLabel = ''
      this._status = { ...DEFAULT_STATUS }
      this.emit('status', this.getStatus())
    }
  }

  private cleanupProcess(): void {
    this.window.reset()
    this.active = false
    this.child = null
    this.sock.destroy()
    this.enhancement.disconnect()
    this._status = { ...DEFAULT_STATUS }
    this.emit('status', this.getStatus())
    this.emit('exit')
  }

  /** 超分配置成功时，右上角角标（mpv-vsr-hook.ts）显示「RTX 超分」 */
  private publishVsrLabel(): void {
    const label =
      this.enhancement.status.state === 'configured' ? 'RTX 超分' : ''
    if (label === this.vsrLabel) return
    this.vsrLabel = label
    void this.setProp('user-data/yingbox-vsr', label).catch(() => {})
  }

  getStatus(): MpvStatus {
    return {
      ...this._status,
      running: Boolean(this.child) && this.active,
      compact: this.window.compact,
      vsr: this.enhancement.status,
      videoWidth: this.enhancement.source?.w,
      videoHeight: this.enhancement.source?.h,
      filteredVideoWidth: this.enhancement.output?.w,
      filteredVideoHeight: this.enhancement.output?.h,
    }
  }

  protected async cmd(...args: unknown[]): Promise<unknown> {
    return this.sock.send({ command: args })
  }

  /** 画面上显示一行提示（OSD）；mpv 没在跑时不做 */
  async showText(text: string, ms: number): Promise<void> {
    if (this.child && this.active) await this.cmd('show-text', text, ms)
  }

  /** 停止播放：进程留着待命（没有连接才真的退出）。窗口会随之消失。 */
  async stop(): Promise<void> {
    if (!this.child || !this.active) return
    if (this.sock.connected) await this.cmd('stop').catch(() => {})
    else await this.terminate()
  }

  /** 退出 mpv（应用退出时由插件宿主调用）：之后不再预热。 */
  async quit(): Promise<void> {
    this.quitting = true
    await this.terminate()
  }

  /** 先发 quit 命令，1.5 秒内没退出就强杀进程树；返回时进程已退出或已放弃等待。 */
  private async terminate(): Promise<void> {
    const child = this.child
    if (!child) return
    await stopProcess(child, { graceful: () => this.cmd('quit') })
  }
}

/** 全局单例 */
export const mpvPlayer = new MpvPlayer()
