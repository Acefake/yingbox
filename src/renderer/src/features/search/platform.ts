import { nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  onlineAvailable,
  requestOnlineDetail,
  useOnlineSearch,
} from '@/features/online'
import { enhanceConditions, enhanceReady } from '@/features/library'
import { fuseSearch, routeSearch, searchLibrary } from '@/features/library'
import { looksNatural } from '@/features/library'
import { localResource, onlineResource } from './resources'
import type { OnlineProvider, SearchEnhancement } from './types'

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

export async function enhanceSearch(
  text: string,
  signal: AbortSignal
): Promise<SearchEnhancement> {
  if (!enhanceReady() || !looksNatural(text))
    return { keywords: [], resources: [], message: '' }
  const filter = await enhanceConditions(text, 'all', signal)
  const batches: Parameters<typeof fuseSearch>[0] = []
  await searchLibrary({ text, scope: 'all', filter, signal }, batch =>
    batches.push(batch)
  )
  return {
    keywords: filter.keywords ?? [],
    resources: fuseSearch(batches, routeSearch(text)).flatMap(hit =>
      hit.versions.map(item => localResource(item, 'AI 理解 · 符合筛选条件'))
    ),
    message: 'AI 已理解搜索条件',
  }
}
