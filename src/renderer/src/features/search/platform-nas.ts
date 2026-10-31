import { nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  onlineAvailable,
  requestOnlineDetail,
  useOnlineSearch,
} from '@/features/online'
import { onlineResource } from './resources'
import type { OnlineProvider, SearchEnhancement } from './types'

/** NAS 按 ADR-0026 保留在线源；模型增强仍关闭。 */
export function useSearchOnline(): OnlineProvider {
  const online = useOnlineSearch()
  const router = useRouter()
  return {
    available: onlineAvailable(),
    async search(keyword, signal, publish) {
      const cancel = (): void => {
        void online.search('')
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        if (signal.aborted) return ''
        await online.search(keyword, {
          onItems: items => {
            if (!signal.aborted) publish(items.map(onlineResource))
          },
        })
        return (
          online.error.value ||
          [
            ...online.failedSources.value,
            ...online.skippedCms.value,
            ...online.skippedPlugins.value,
          ]
            .map(name => `${name} 暂不可用`)
            .join('；')
        )
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
    async open(resource) {
      if (!resource.online) return
      await router.push('/')
      await nextTick()
      requestOnlineDetail(resource.online)
    },
  }
}

export async function enhanceSearch(): Promise<SearchEnhancement> {
  return { keywords: [], resources: [], message: '' }
}
