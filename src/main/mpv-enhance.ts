/** mpv 画质增强：高质量缩放、去色带与 CAS 锐化，只对确认的 SDR 生效。 */
import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from './file-operations'
import {
  type EnhanceLevel,
  casMpvShader,
  isSdrColor,
} from '../shared/playback/enhance'

/** 当前档位与片源色彩对应的 mpv 属性。 */
export function enhanceProps(
  level: EnhanceLevel,
  sdr: boolean,
  shaderPath: string | null,
  baseScale: string
): Array<[string, unknown]> {
  const on = level !== 'off' && sdr && shaderPath !== null
  return [
    ['scale', on ? 'ewa_lanczossharp' : baseScale],
    ['deband', on],
    ['glsl-shaders', on ? [shaderPath] : []],
  ]
}

/** 把 video-dec-params 判定为 SDR；缺信息一律视为非 SDR。 */
export function paramsAreSdr(params: unknown): boolean {
  if (params === null || typeof params !== 'object') return false
  const p = params as Record<string, unknown>
  return p.colormatrix !== 'dolbyvision' && isSdrColor(p.gamma, p.primaries)
}

/** 把档位对应的着色器写进 userData 并返回路径。 */
export async function ensureEnhanceShader(
  level: EnhanceLevel
): Promise<string | null> {
  if (level === 'off') return null
  const dir = join(app.getPath('userData'), 'mpv')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `enhance-cas-${level}.glsl`)
  await atomicWrite(file, casMpvShader(level))
  return file
}

/** 持有档位、SDR 状态与已下发结果，只在结果变化时写 mpv 属性。 */
export class MpvImageEnhance {
  private level: EnhanceLevel = 'off'
  private sdr = false
  highQuality = false
  private applied = ''
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly setProp: (name: string, value: unknown) => Promise<void>,
    private readonly live: () => boolean
  ) {}

  setLevel(level: EnhanceLevel): Promise<void> {
    this.level = level
    return this.apply()
  }

  toggle(): Promise<void> {
    return this.setLevel(this.level === 'off' ? 'standard' : 'off')
  }

  setHighQuality(enabled: boolean): Promise<void> {
    this.highQuality = enabled
    this.applied = ''
    return this.apply()
  }

  /** 新进程启动：忘记上次下发的结果与片源色彩。 */
  reset(): Promise<void> {
    this.applied = ''
    this.sdr = false
    return this.apply()
  }

  /** 片源色彩变化时重新判定，返回 false 表示无需处理。 */
  onParams(params: unknown): Promise<void> {
    const sdr = paramsAreSdr(params)
    if (sdr === this.sdr) return Promise.resolve()
    this.sdr = sdr
    return this.apply()
  }

  private apply(): Promise<void> {
    const operation = this.queue.then(() => this.applyCurrent())
    this.queue = operation.catch(() => {})
    return operation
  }

  private async applyCurrent(): Promise<void> {
    if (!this.live()) return
    const level = this.level
    const sdr = this.sdr
    const highQuality = this.highQuality
    const key = `${level}:${sdr}:${highQuality}`
    if (key === this.applied) return
    const shader = await ensureEnhanceShader(level)
    const props = enhanceProps(
      level,
      sdr,
      shader,
      highQuality ? 'ewa_lanczossharp' : 'lanczos'
    )
    for (const [name, value] of props) await this.setProp(name, value)
    await this.setProp(
      'user-data/yingbox-enhance',
      level === 'off' ? '' : sdr ? 'CAS' : '旁路'
    )
    this.applied = key
  }
}
