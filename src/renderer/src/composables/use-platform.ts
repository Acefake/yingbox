import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'

/** Shared shell/platform flags for Electron desktop, desktop web, and phone. */
export function usePlatform() {
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
