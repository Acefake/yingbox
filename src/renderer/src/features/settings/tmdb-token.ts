/**
 * TMDB 令牌：设置里的密钥 `scrape.tmdbToken`。渲染层只写不读。
 *
 * 明文只在主进程（safeStorage 加密落盘）；在线页面的 TMDB 请求在后台引擎发出（online.tmdb），
 * 主进程保存时一并下发给媒体库引擎（见 src/main/tmdb.ts）。渲染层只知道「是否已配置」：
 * 启动快照里的密钥状态，之后跟随 secretChanged 事件（任一窗口修改都会广播）。
 * Web / PWA 模式没有主进程，TMDB 功能本来就不可用，这里视为未配置。
 */
import { type Ref, ref } from 'vue'

const KEY = 'scrape.tmdbToken'

const bridge = typeof window !== 'undefined' ? window.api?.settings : undefined
const configured = ref(bridge ? bridge.snapshot().secrets[KEY] : false)

bridge?.onSecretChanged(change => {
  if (change.key === KEY) configured.value = change.configured
})

/** 用户是否填写了令牌（不含构建时默认值）；响应式 */
export function tmdbTokenConfigured(): boolean {
  return configured.value
}

/** 修改令牌（空串表示清除）：交主进程加密保存并下发给媒体库引擎 */
export async function setTmdbToken(value: string): Promise<void> {
  if (!bridge) throw new Error('TMDB 令牌需要桌面端')
  const next = value.trim()
  await bridge.setSecret(KEY, next)
  configured.value = next !== ''
}

/** 令牌输入框的草稿：输入停顿后保存，空草稿不保存（清除走 clear）。 */
export interface TokenDraft {
  readonly value: Ref<string>
  /** 输入框内容变化 */
  input(value: string): void
  /** 离开页面时：有待保存的输入立即保存 */
  flush(): void
  /** 清空草稿并清除已保存的令牌 */
  clear(): void
}

/** 创建令牌草稿（save 失败由调用方处理）。 */
export function createTokenDraft(
  save: (value: string) => void,
  delayMs = 600
): TokenDraft {
  const value = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  return {
    value,
    input(next) {
      value.value = next
      cancel()
      if (!next.trim()) return
      timer = setTimeout(() => {
        timer = undefined
        save(next)
      }, delayMs)
    },
    flush() {
      if (!timer) return
      cancel()
      save(value.value)
    },
    clear() {
      cancel()
      value.value = ''
      save('')
    },
  }
}
