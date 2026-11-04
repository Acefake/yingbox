/** mpv 超分的启用规则与命名滤镜生命周期，不修改其他滤镜或声称 AI 效果已验证。 */
import type { MpvVsrStatus } from '../shared/mpv'

/** 影盒独占的滤镜标签。 */
export const VSR_LABEL = 'yingbox-vsr'
const FILTER = `@${VSR_LABEL}:d3d11vpp=scale=2:scaling-mode=nvidia`
type Send = (...args: unknown[]) => Promise<unknown>
type Size = { w: number; h: number }
type Decision = MpvVsrStatus | { state: 'ready'; reason: string }

interface DecisionInput {
  enabled: boolean
  platform: string
  video: unknown
  display: unknown
  hwdec: unknown
  nvidia: boolean | null
  track?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function size(value: unknown): Size | null {
  const data = record(value)
  const valid = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0
  return data && valid(data.w) && valid(data.h)
    ? { w: data.w, h: data.h }
    : null
}

function colorDecision(
  video: Record<string, unknown> | null
): MpvVsrStatus | null {
  const gamma =
    typeof video?.gamma === 'string' ? video.gamma.toLowerCase() : ''
  const primaries = video?.primaries
  if (
    gamma === 'pq' ||
    gamma === 'hlg' ||
    primaries === 'bt.2020' ||
    video?.colormatrix === 'dolbyvision'
  ) {
    return {
      state: 'bypassed',
      reason: 'HDR、杜比视界或广色域片源保持原生路径',
    }
  }
  if (
    !['bt.1886', 'srgb', 'gamma2.2', 'gamma2.4', 'bt.709'].includes(gamma) ||
    primaries !== 'bt.709'
  ) {
    return { state: 'bypassed', reason: '色彩信息未确认为常规 SDR' }
  }
  return null
}

/** 只允许已确认的常规 SDR 在实际需要放大时尝试 VSR。 */
export function vsrDecision(input: DecisionInput): Decision {
  if (!input.enabled) return { state: 'off', reason: '未开启' }
  if (input.platform !== 'win32')
    return { state: 'unsupported', reason: '仅 Windows 支持此超分路径' }
  const video = record(input.video)
  const source = size(video)
  const display = size(input.display)
  if (!source || !display)
    return { state: 'waiting', reason: '等待片源和显示尺寸' }
  const color = colorDecision(video)
  if (color) return color
  const track = record(input.track)
  if (!track || track.type !== 'video')
    return { state: 'bypassed', reason: '当前视频轨元数据未确认' }
  if (typeof track['dolby-vision-profile'] === 'number')
    return { state: 'bypassed', reason: '杜比视界片源保持原生路径' }
  if (source.w >= 1920 || source.h >= 1080)
    return { state: 'bypassed', reason: '片源已达到 1080p 或更高分辨率档位' }
  const margins = record(input.display)
  const margin = (key: string): number =>
    typeof margins?.[key] === 'number' && Number.isFinite(margins[key])
      ? Math.max(0, margins[key])
      : 0
  const width = display.w - margin('ml') - margin('mr')
  const height = display.h - margin('mt') - margin('mb')
  const displaySource = size({ w: video?.dw, h: video?.dh }) ?? source
  if (width <= displaySource.w && height <= displaySource.h)
    return { state: 'bypassed', reason: '当前显示区域无需放大' }
  if (input.nvidia === false)
    return { state: 'unsupported', reason: '未检测到 NVIDIA GPU' }
  if (input.nvidia === null)
    return { state: 'waiting', reason: '无法确认 NVIDIA GPU 能力' }
  if (input.hwdec !== 'd3d11va')
    return {
      state: 'unsupported',
      reason: '当前未使用 D3D11 硬解，重新打开片源后再试',
    }
  return { state: 'ready', reason: '可尝试配置' }
}

function hasFilter(value: unknown): boolean {
  return Array.isArray(value) && value.some(v => record(v)?.label === VSR_LABEL)
}

/** 串行管理影盒滤镜；进程和媒体代数阻止迟到响应污染新的会话。 */
export class MpvEnhancement {
  status: MpvVsrStatus = { state: 'off', reason: '未开启' }
  source: Size | null = null
  output: Size | null = null
  private enabled = false
  private video: unknown = null
  private display: unknown = null
  private hwdec: unknown = null
  private nvidia: boolean | null = null
  private connected = false
  private suspended = true
  private hooksReady = false
  private gpuProbe: Promise<boolean | null> | null = null
  private generation = 0
  private processGeneration = 0
  private failed = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly send: Send,
    private readonly changed: () => void,
    private readonly platform: string,
    private readonly probeNvidia: () => Promise<boolean | null>
  ) {}

  /** IPC 就绪后探测 GPU，不把 Electron 的设备枚举当成 mpv 效果证明。 */
  async connect(hooksReady = true): Promise<void> {
    this.connected = true
    this.suspended = false
    this.hooksReady = hooksReady
    if (this.enabled) await this.detectGpu()
    await this.sync()
  }

  private async detectGpu(): Promise<void> {
    const gen = this.processGeneration
    this.gpuProbe ??=
      this.platform === 'win32' ? this.probeNvidia() : Promise.resolve(false)
    const nvidia = await this.gpuProbe
    if (gen !== this.processGeneration || !this.connected) return
    this.nvidia = nvidia
    if (nvidia === null) this.gpuProbe = null
  }

  /** 打开媒体前清除自身滤镜；清除失败时不允许受控换片继续。 */
  async startFile(): Promise<void> {
    this.suspended = false
    await this.resetMedia()
  }

  /** 受控换片准备期间忽略旧视频格式与刷新，直到 mpv 发出新文件 start-file。 */
  async prepareFile(): Promise<void> {
    this.suspended = true
    await this.resetMedia()
  }

  private async resetMedia(): Promise<void> {
    this.generation++
    this.video = null
    this.hwdec = null
    this.source = null
    this.output = null
    this.failed = false
    this.status = {
      state: this.enabled ? 'waiting' : 'off',
      reason: this.enabled ? '等待当前片源' : '未开启',
    }
    this.changed()
    await this.sync(true)
  }

  /** 进程结束后遗忘运行状态；用户开关保留用于下一次播放。 */
  disconnect(): void {
    this.generation++
    this.processGeneration++
    this.connected = false
    this.suspended = true
    this.gpuProbe = null
    this.video = this.display = this.hwdec = null
    this.source = this.output = null
    this.nvidia = null
    this.failed = false
    this.status = {
      state: this.enabled ? 'waiting' : 'off',
      reason: this.enabled ? '等待播放器' : '未开启',
    }
  }

  /** 更新观察属性；输入尺寸取解码器原始数据，输出尺寸不参与启用判定。 */
  update(name: string, value: unknown): boolean {
    if (
      this.suspended &&
      ['video-dec-params', 'video-out-params', 'hwdec-current'].includes(name)
    )
      return true
    if (name === 'video-dec-params') {
      this.video = value
      this.source = size(value)
    } else if (name === 'video-out-params') {
      this.output = size(value)
      return true
    } else if (name === 'osd-dimensions') this.display = value
    else if (name === 'hwdec-current') this.hwdec = value
    else if (name !== 'vf') return false
    void this.sync()
    return true
  }

  /** 改变开关时允许重新尝试一次，失败不会随属性更新反复重试。 */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    this.failed = false
    if (!this.connected) {
      this.status = {
        state: enabled ? 'waiting' : 'off',
        reason: enabled ? '等待播放器' : '未开启',
      }
      this.changed()
    }
    if (enabled && this.connected) await this.detectGpu()
    await this.sync()
  }

  /** 播放重启后读取当前值，防止换片时未变化的属性没有产生观察事件。 */
  async refresh(): Promise<void> {
    if (this.suspended || !this.connected) return
    const gen = this.generation
    for (const name of [
      'video-dec-params',
      'video-out-params',
      'osd-dimensions',
      'hwdec-current',
    ]) {
      const value = await this.send('get_property', name)
      if (gen !== this.generation || !this.connected) return
      this.update(name, value)
    }
    await this.idle()
  }

  /** 等待已排队的滤镜更新完成。 */
  idle(): Promise<void> {
    return this.queue
  }

  private sync(strict = false): Promise<void> {
    const gen = this.generation
    const operation = this.queue
      .then(async () => {
        if (gen !== this.generation || !this.connected || this.failed) return
        await this.reconcile(gen)
      })
      .catch(async error => {
        if (gen !== this.generation) return
        await this.recoverFailure(gen)
        if (strict && gen === this.generation) throw error
      })
    this.queue = operation.catch(() => {})
    return operation
  }

  private async recoverFailure(gen: number): Promise<void> {
    this.failed = true
    this.status = {
      state: 'failed',
      reason: '滤镜配置失败，增强未确认；可关闭后重试',
    }
    try {
      const filters = await this.send('get_property', 'vf')
      if (gen !== this.generation) return
      if (hasFilter(filters)) await this.send('vf', 'remove', `@${VSR_LABEL}`)
    } catch {
      if (gen === this.generation)
        this.status = {
          state: 'failed',
          reason: '无法确认滤镜已移除，请重新打开播放器',
        }
    }
    if (gen !== this.generation) return
    this.changed()
  }

  private async reconcile(gen: number): Promise<void> {
    const track =
      this.enabled && !this.suspended
        ? await this.send('get_property', 'current-tracks/video').catch(
            () => null
          )
        : null
    if (gen !== this.generation) return
    const decision = this.suspended
      ? { state: 'waiting' as const, reason: '等待当前片源' }
      : this.enabled && !this.hooksReady
        ? {
            state: 'unsupported' as const,
            reason: 'mpv 换片保护未就绪，超分保持旁路',
          }
        : vsrDecision({
            enabled: this.enabled,
            platform: this.platform,
            video: this.video,
            display: this.display,
            hwdec: this.hwdec,
            nvidia: this.nvidia,
            track,
          })
    const filters = await this.send('get_property', 'vf')
    if (gen !== this.generation) return
    const present = hasFilter(filters)
    if (decision.state !== 'ready') {
      if (present) {
        this.output = null
        await this.send('vf', 'remove', `@${VSR_LABEL}`)
      }
      if (gen !== this.generation) return
      this.status = decision
    } else {
      await this.configure(gen, present)
    }
    this.changed()
  }
  private async configure(gen: number, present: boolean): Promise<void> {
    if (!present) {
      this.output = null
      await this.send('vf', 'add', FILTER)
    }
    if (gen !== this.generation) return
    const actual = await this.send('get_property', 'vf')
    if (gen !== this.generation) return
    if (!hasFilter(actual)) throw new Error('mpv 未保留超分滤镜')
    const disabled =
      Array.isArray(actual) &&
      actual.some(
        v => record(v)?.label === VSR_LABEL && record(v)?.enabled === false
      )
    this.status = disabled
      ? { state: 'bypassed', reason: '超分滤镜已被禁用' }
      : {
          state: 'configured',
          reason: 'NVIDIA 超分滤镜已配置，AI 效果未验证',
        }
  }
}
