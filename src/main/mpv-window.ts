/**
 * mpv 窗口的「在最前」状态：新播放时一瞬间置顶把窗口顶到最前，以及「缩小置顶」（右下角小窗、一直在最前）。
 * 两者共用 mpv 的 ontop 属性，放在一起才不会互相覆盖：缩小置顶时不做一瞬间置顶后的取消。
 */
import { compactProps } from './mpv-props'

/** 新播放时窗口「一瞬间置顶」的时长，之后自动取消置顶 */
const ONTOP_FLASH_MS = 1000

/** 设一个 mpv 属性 */
type SetProp = (name: string, value: unknown) => Promise<void>

/** 一个 mpv 进程的窗口置顶状态 */
export class MpvWindow {
  /** 处于「缩小置顶」 */
  compact = false
  /** 「一瞬间置顶」的还原定时器 */
  private ontopTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly setProp: SetProp) {}

  /**
   * 把窗口提到最前（每次新播放时调用）：取消最小化 → 置顶 → 短暂延时后自动取消置顶，
   * 避免播放窗口一直压在其他窗口上面。缩小置顶时窗口本来就在最前，只取消最小化。
   */
  async bringToFront(): Promise<void> {
    try {
      await this.setProp('window-minimized', false)
      if (this.compact) return
      await this.setProp('ontop', false)
      await this.setProp('ontop', true)
      this.clearTimer()
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

  /** 缩小置顶 / 还原 */
  async setCompact(on: boolean): Promise<void> {
    this.clearTimer()
    for (const [name, value] of compactProps(on))
      await this.setProp(name, value)
    this.compact = on
  }

  /** 进程退出：复位 */
  reset(): void {
    this.clearTimer()
    this.compact = false
  }

  private clearTimer(): void {
    if (!this.ontopTimer) return
    clearTimeout(this.ontopTimer)
    this.ontopTimer = null
  }
}
