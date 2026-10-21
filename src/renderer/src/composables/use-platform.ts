import { type ComputedRef, computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'

/** 运行环境：Electron / 网页、窄屏判断、是否有本地媒体库 */
export interface UsePlatformReturn {
  isElectron: boolean
  isWeb: boolean
  isPhone: ComputedRef<boolean>
  isCompact: ComputedRef<boolean>
  hasLocalLibrary: ComputedRef<boolean>
}

/** Shared shell/platform flags for Electron desktop, desktop web, and phone. */
export function usePlatform(): UsePlatformReturn {
  const isElectron = typeof window !== 'undefined' && Boolean(window.api?.win)
  const isPhone = useMediaQuery('(max-width: 768px)')
  const isCompact = useMediaQuery('(max-width: 1100px)')

  return {
    isElectron,
    isWeb: !isElectron,
    isPhone,
    isCompact,
    hasLocalLibrary: computed(() => isElectron),
  }
}
