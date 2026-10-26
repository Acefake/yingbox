/**
 * mpv 打开远程地址时的请求头：mpv 不经 Chromium 会话，防盗链 Referer 与线路自带的 UA / Referer 要自己带。
 * 直播线路的地址可能带 `|User-Agent=…&Referer=…`（见 shared/net/stream-headers），这里拆掉后缀，转成 mpv 选项。
 *
 * 已在运行的进程换片时用 {@link MpvHeaderState}：只在本次要带头时才设，设之前记下原值；
 * 换到不带头的线路时还原成原值（用户 mpv.conf 里的 UA / Referer 不会被影盒覆盖）。
 */
import { refererFor } from './media-headers'
import { splitStreamHeaders } from '../shared/net/stream-headers'
import type { MpvOpenOptions } from '../shared/mpv'

/** 影盒会改的两个 mpv 选项 */
export type MpvHeaderName = 'referrer' | 'user-agent'
/** 本次打开要带的请求头（没有的项不改） */
export type MpvHeaders = Partial<Record<MpvHeaderName, string>>

const HEADER_NAMES: MpvHeaderName[] = ['referrer', 'user-agent']
/** mpv 内置默认值：新进程由命令行带了头、读不到原值时还原用 */
const MPV_DEFAULTS: Record<MpvHeaderName, string> = {
  referrer: '',
  'user-agent': 'libmpv',
}

/** 打开目标（已去掉请求头后缀）与要带的请求头 */
export function mpvStream(options: MpvOpenOptions): {
  target: string
  headers: MpvHeaders
} {
  if (options.filePath || !options.url)
    return { target: options.filePath || options.url || '', headers: {} }
  const { url, headers } = splitStreamHeaders(options.url)
  const referer = headers?.referer ?? refererFor(url)
  const userAgent = headers?.userAgent
  return {
    target: url,
    headers: {
      ...(referer ? { referrer: referer } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {}),
    },
  }
}

/** 新进程命令行里的请求头参数 */
export function headerArgs(headers: MpvHeaders): string[] {
  return HEADER_NAMES.filter(name => headers[name]).map(
    name => `--${name}=${headers[name]}`
  )
}

/** 一个 mpv 进程里被影盒改过的请求头选项及其原值 */
export class MpvHeaderState {
  private readonly original = new Map<MpvHeaderName, string>()

  /**
   * @param get 读 mpv 属性（失败抛错时按 mpv 默认值记原值）
   * @param set 设 mpv 属性
   */
  constructor(
    private readonly get: (name: MpvHeaderName) => Promise<unknown>,
    private readonly set: (name: MpvHeaderName, value: string) => Promise<void>
  ) {}

  /** 新进程：命令行带了的头记为已改（原值按 mpv 默认，命令行已盖过 mpv.conf，读不到） */
  reset(spawned: MpvHeaders = {}): void {
    this.original.clear()
    for (const name of HEADER_NAMES)
      if (spawned[name]) this.original.set(name, MPV_DEFAULTS[name])
  }

  /** 换片前同步请求头：要带的先记原值再设；本次不带、之前改过的还原 */
  async apply(headers: MpvHeaders): Promise<void> {
    for (const name of HEADER_NAMES) {
      const want = headers[name]
      if (want) {
        if (!this.original.has(name))
          this.original.set(name, await this.readOriginal(name))
        await this.set(name, want)
      } else if (this.original.has(name)) {
        await this.set(name, this.original.get(name)!)
        this.original.delete(name)
      }
    }
  }

  private async readOriginal(name: MpvHeaderName): Promise<string> {
    try {
      const value = await this.get(name)
      return typeof value === 'string' ? value : MPV_DEFAULTS[name]
    } catch {
      return MPV_DEFAULTS[name]
    }
  }
}
