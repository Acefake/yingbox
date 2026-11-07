import { type ComputedRef, type Ref, computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'

import { libraryServerState } from '@/services/library-server'

/** 运行环境：Electron / 网页、窄屏判断、是否有本地媒体库（桌面端，或网页端连得上片库服务） */
export interface UsePlatformReturn {
  isElectron: boolean
  isMac: boolean
  isWeb: boolean
  isPhone: ComputedRef<boolean>
  /** 网页中等宽度窗口；窄分屏使用手机布局。 */
  isTablet: ComputedRef<boolean>
  isTouch: Ref<boolean>
  isCompact: ComputedRef<boolean>
  hasLocalLibrary: ComputedRef<boolean>
}

/** Shared shell/platform flags for Electron desktop, desktop web, and phone. */
export function usePlatform(): UsePlatformReturn {
  const isElectron = typeof window !== 'undefined' && Boolean(window.api?.win)
  const isMac =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const server = libraryServerState()
  const isTouch = useMediaQuery('(any-pointer: coarse)')
  const narrow = useMediaQuery('(max-width: 599px)')
  const short = useMediaQuery('(max-width: 959px) and (max-height: 480px)')
  const tabletWidth = useMediaQuery(
    '(min-width: 600px) and (max-width: 1366px)'
  )
  const isPhone = computed(() => narrow.value || (isTouch.value && short.value))
  const isTablet = computed(
    () => !isElectron && tabletWidth.value && !isPhone.value
  )
  const isCompact = useMediaQuery('(max-width: 1100px)')

  return {
    isElectron,
    isMac,
    isWeb: !isElectron,
    isPhone,
    isTablet,
    isTouch,
    isCompact,
    hasLocalLibrary: computed(
      () =>
        isElectron ||
        server.value === 'online' ||
        server.value === 'unauthorized'
    ),
  }
}
