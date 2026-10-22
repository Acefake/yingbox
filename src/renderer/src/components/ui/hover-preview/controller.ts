/**
 * 悬停预览控制器（纯逻辑，不碰 DOM）：延时、全局只播一张、离开即释放。
 *
 * - enter：先停掉正在播 / 正在等的那张，再按设置的延时计时；到点才调用来源的 resolve；
 * - 同一张卡（同 key、同容器）重复 enter 不重新计时；
 * - leave(key) 只停这张；stop() 停全部（页面切走、窗口隐藏、多选模式）；
 * - 设置关闭或系统「减少动态效果」时不自动播；
 * - 取源中途离开：中止 signal，结果回来也丢掉。
 */
import type { PreviewMedia, PreviewSettings, PreviewSource } from './types'

/** 真正播放的地方（DOM 实现见 stage.ts）。 */
export interface PreviewStage {
  show(host: HTMLElement, media: PreviewMedia): void
  clear(): void
}

/** 控制器依赖。 */
export interface PreviewControllerDeps {
  stage: PreviewStage
  /** 每次进入时读一次，设置随时生效 */
  settings: () => PreviewSettings
  /** 系统是否开启了「减少动态效果」 */
  reducedMotion: () => boolean
}

/** 控制器。 */
export interface PreviewController {
  enter(source: PreviewSource, host: HTMLElement): void
  leave(key: string): void
  stop(): void
  /** 当前在等或在播的卡的 key */
  activeKey(): string | null
}

interface Active {
  source: PreviewSource
  host: HTMLElement
  timer?: ReturnType<typeof setTimeout>
  abort?: AbortController
  shown: boolean
}

/** 创建控制器（应用里只有一个，见 use-hover-preview.ts）。 */
export function createPreviewController(
  deps: PreviewControllerDeps
): PreviewController {
  let active: Active | null = null

  async function start(entry: Active): Promise<void> {
    entry.timer = undefined
    const abort = new AbortController()
    entry.abort = abort
    let media: PreviewMedia | null = null
    try {
      media = await entry.source.resolve(abort.signal)
    } catch {
      media = null
    }
    if (active !== entry || abort.signal.aborted || !media) return
    entry.shown = true
    deps.stage.show(entry.host, media)
  }

  function stop(): void {
    const entry = active
    if (!entry) return
    active = null
    if (entry.timer) clearTimeout(entry.timer)
    entry.abort?.abort()
    if (entry.shown) deps.stage.clear()
  }

  return {
    enter(source, host) {
      if (active?.source.key === source.key && active.host === host) return
      stop()
      const settings = deps.settings()
      if (!settings.enabled || deps.reducedMotion()) return
      const entry: Active = { source, host, shown: false }
      active = entry
      entry.timer = setTimeout(() => void start(entry), settings.delayMs)
    },
    leave(key) {
      if (active?.source.key === key) stop()
    },
    stop,
    activeKey: () => active?.source.key ?? null,
  }
}
