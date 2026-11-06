import { type ChildProcess, spawn } from 'child_process'
import { MpvControls } from './mpv-controls'
import { type DiscSource, discSourceOf } from './mpv-disc'
import { ensureMpvExecutable } from './mpv-locate'
import { validateMpvLocalFile } from './mpv-local-file'
import {
  COMPACT_KEY,
  COMPACT_MESSAGE,
  DEFAULT_STATUS,
  WATCH_PROPS,
  patchStatus,
  replaceProps,
  spawnArgs,
} from './mpv-props'
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

  /**
   * 打开媒体。若 mpv 已在运行则替换当前文件，否则启动新进程。
   * 多次调用按顺序执行；失败时已有更新的 open 在排队，这次算被取代，静默返回（以最后一次为准）。
   */
  open(options: MpvOpenOptions): Promise<void> {
    if (!options.filePath && !options.url)
      return Promise.reject(new Error('mpv: 必须指定 filePath 或 url'))
    const seq = ++this.openSeq
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
    try {
      await validateMpvLocalFile(options.filePath)
      const disc = await discSourceOf(options.filePath)
      if (this.child && this.sock.connected) {
        await this.enhancement.prepareFile()
        const stream = mpvStream(options, disc)
        if (disc) await this.setProp(disc.option, disc.device).catch(warnProp)
        // 属性设不上（低版本 mpv 不认某个值等）只记日志，照样换片，不让整次 open 失败
        await this.headers.apply(stream.headers).catch(warnProp)
        for (const [name, value] of replaceProps(options))
          await this.setProp(name, value).catch(warnProp)
        await this.cmd('loadfile', stream.target, 'replace')
        if (options.subFile)
          await this.cmd('sub-add', options.subFile, 'select')
        await this.window.bringToFront()
      } else {
        await this.spawnProcess(options, disc)
      }
    } catch (error) {
      this._status.loading = false
      this.emit('status', this.getStatus())
      throw error
    }
  }

  private async spawnProcess(
    options: MpvOpenOptions,
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
    const { target, headers } = mpvStream(options, disc)
    const hookScript = await ensureMpvVsrHook()
    const args = spawnArgs({
      socket,
      target,
      startAt: options.startAt,
      title: options.title,
      subFile: options.subFile,
      headers,
      vsr: this.isVsrWanted(),
      highQualityScaling: this.imageEnhance.highQuality,
      disc,
      hookScript,
      ui: locateMpvUi(settingsStore().get('player.mpvUi')),
    })
    this.headers.reset(headers)
    const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false })
    this.child = child
    let spawnError: Error | null = null
    let exitDetail: string | null = null
    child.once('error', e => {
      spawnError = e
      if (this.child !== child) return
      this.emit('error', `mpv 启动失败: ${e.message}`)
      this.cleanupProcess()
    })
    child.once('exit', (code, signal) => {
      exitDetail = signal ? `信号 ${signal}` : `退出码 ${code ?? '未知'}`
      if (this.child === child) this.cleanupProcess()
    })
    try {
      await this.sock.connect(socket, undefined, () => this.child !== child)
    } catch (error) {
      // 连不上：不留没人管的 mpv 进程
      if (this.child === child) {
        this.cleanupProcess()
        void killTree(child)
      }
      const failed = spawnError as Error | null
      if (failed) throw new Error(`mpv 启动失败: ${failed.message}`)
      if (exitDetail) throw new Error(`mpv 启动后退出（${exitDetail}）`)
      throw error
    }
    const hookReady = hookScript
      ? await this.cmd('get_property', 'user-data/yingbox-vsr-hook').catch(
          () => null
        )
      : null
    let protectedReady = hookReady === 'ready'
    if (protectedReady)
      protectedReady = await this.setProp(
        'user-data/yingbox-vsr-controlled',
        true
      ).then(
        () => true,
        () => false
      )
    await this.enhancement.connect(protectedReady)
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
    await this.imageEnhance.reset().catch(warnProp)
    // mpv 窗口里按快捷键切换缩小置顶（mpv 不支持 keybind 命令时忽略）
    await this.sock
      .send({
        command: ['keybind', COMPACT_KEY, `script-message ${COMPACT_MESSAGE}`],
      })
      .catch(() => {})
    this.emit('status', this.getStatus())
  }

  private onEvent(msg: Record<string, unknown>): void {
    if (
      msg.event === 'client-message' &&
      Array.isArray(msg.args) &&
      msg.args[0] === 'yingbox-enhance-toggle'
    ) {
      void this.imageEnhance.toggle().catch(warnProp)
      return
    }
    if (msg.event === 'property-change')
      this.applyProp(msg.name as string, msg.data)
    else if (msg.event === 'end-file') {
      this._status.loading = false
      this.emit('status', this.getStatus())
      this.emit('end-file', msg.reason)
    } else if (msg.event === 'start-file') {
      void this.enhancement.prepareFile().catch(warnEnhancement)
      this._status.loading = true
      this.emit('status', this.getStatus())
      this.emit('start-file')
    } else if (msg.event === 'file-loaded') {
      void this.enhancement.startFile().catch(warnEnhancement)
    } else if (
      msg.event === 'client-message' &&
      Array.isArray(msg.args) &&
      msg.args[0] === 'yingbox-vsr-load'
    ) {
      const [, id, script] = msg.args
      if (
        typeof id === 'string' &&
        /^\d+$/.test(id) &&
        typeof script === 'string' &&
        /^[\w-]+$/.test(script)
      )
        void this.continueVsrLoad(id, script)
    } else if (
      msg.event === 'client-message' &&
      Array.isArray(msg.args) &&
      msg.args[0] === COMPACT_MESSAGE
    ) {
      void this.setCompact(!this.window.compact).catch(() => {})
    } else if (msg.event === 'playback-restart') {
      void this.enhancement.refresh().catch(warnEnhancement)
      this._status.loading = false
      this.emit('status', this.getStatus())
    }
  }

  private applyProp(name: string, data: unknown): void {
    if (!this.enhancement.update(name, data))
      patchStatus(this._status, name, data)
    if (name === 'video-dec-params')
      void this.imageEnhance.onParams(data).catch(warnProp)
    this.emit('status', this.getStatus())
  }

  private async continueVsrLoad(id: string, script: string): Promise<void> {
    const child = this.child
    if (!child) return
    try {
      await this.enhancement.prepareFile()
    } catch (error) {
      warnEnhancement(error)
      if (this.child === child && this.sock.connected)
        await this.cmd('stop').catch(warnEnhancement)
    } finally {
      if (this.child === child && this.sock.connected)
        await this.cmd(
          'script-message-to',
          script,
          'yingbox-vsr-continue',
          id
        ).catch(warnEnhancement)
    }
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
    if (!this.child) return
    await this.window.setCompact(on)
    this.emit('status', this.getStatus())
  }

  /** 设置 RTX 视频超分开关（来自渲染层的「设置 → 播放器」）。 */
  async setVsrEnabled(enabled: boolean): Promise<void> {
    if (this.vsrEnabled === enabled) return
    this.vsrEnabled = enabled
    await this.enhancement.setEnabled(enabled)
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
      running: Boolean(this.child),
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
    if (this.child) await this.cmd('show-text', text, ms)
  }

  /** 退出 mpv：先发 quit 命令，1.5 秒内没退出就强杀进程树；返回时进程已退出或已放弃等待。 */
  async quit(): Promise<void> {
    const child = this.child
    if (!child) return
    await stopProcess(child, { graceful: () => this.cmd('quit') })
  }
}

const warnProp = (error: unknown): void =>
  console.warn('[mpv] 换片前设置属性失败，照样换片：', error)

const warnEnhancement = (error: unknown): void =>
  console.warn('[mpv] 更新增强状态失败：', error)

/** 全局单例 */
export const mpvPlayer = new MpvPlayer()
