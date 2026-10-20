/**
 * 片库页与 Amane 后台的连接：首次进入时按设置决定启动后台或打开连接设置，
 * 之后每 7 秒轮询状态，后台就绪后自动刷新片库 / 文件 / 任务。
 *
 * Web/PWA（没有 Electron 桥）经 vite 同源代理直连，视为已连接。
 */
import { type Ref, computed, ref } from 'vue'
import type { AmaneStatus } from '../../../../../shared/amane'
import type { AmaneTab } from '../utils/library-query'

/** 打开全局设置的 Amane 分区（section = 'agent' 时到智能体子页） */
export function openGlobalSettings(section = 'scraping'): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', {
      detail: section === 'agent' ? 'amane:agent' : 'amane',
    })
  )
}

export interface ConnectionContext {
  busy: Ref<boolean>
  error: Ref<string>
  tab: Ref<AmaneTab>
  run: (action: () => Promise<void>) => Promise<void>
  load: (silent?: boolean) => Promise<void>
}

export function useAmaneConnection(ctx: ConnectionContext) {
  const status = ref<AmaneStatus | null>(null)
  const isWeb = !window.api?.amane
  const connected = computed(() => isWeb || status.value?.state === 'running')
  // 首次打开时后台还在启动：区分“加载中”和“未连接”，避免闪出连接设置空状态。
  const connecting = ref(true)
  let disposed = false,
    pollTimer: ReturnType<typeof setTimeout> | undefined

  async function refreshAll(): Promise<void> {
    await ctx.run(async () => {
      if (window.api?.amane) status.value = await window.api.amane.status()
      await ctx.load()
    })
  }

  async function connect(): Promise<void> {
    await ctx.run(async () => {
      connecting.value = true
      try {
        status.value = await window.api.amane.start()
        if (connected.value) await ctx.load()
        else ctx.error.value = status.value.error || 'Amane 未能启动'
      } finally {
        connecting.value = false
      }
    })
  }

  async function poll(): Promise<void> {
    if (disposed) return
    if (!ctx.busy.value) {
      try {
        if (window.api?.amane) status.value = await window.api.amane.status()
        // 后台就绪后自动出片库；连接成功后由页面自身重试，不在这里启动后台。
        if (
          connected.value &&
          ['tasks', 'films', 'files'].includes(ctx.tab.value)
        )
          await ctx.load(true)
      } catch {
        /* the next manual connection reports the error */
      }
    }
    if (!disposed) pollTimer = setTimeout(() => void poll(), 7000)
  }

  /** 首次进入：有后台程序 / 外部服务 / 开发源码就启动，否则打开连接设置 */
  async function start(): Promise<void> {
    if (isWeb) {
      connecting.value = false
      void poll()
      return
    }
    try {
      status.value = await window.api.amane.status()
      if (
        status.value.settings.executablePath ||
        status.value.settings.mode === 'external' ||
        status.value.settings.devSource
      )
        await connect()
      else {
        connecting.value = false
        openGlobalSettings()
      }
      void poll()
    } catch (e) {
      connecting.value = false
      ctx.error.value = (e as Error).message
    }
  }

  function dispose(): void {
    disposed = true
    clearTimeout(pollTimer)
  }

  return { status, isWeb, connected, connecting, refreshAll, start, dispose }
}
