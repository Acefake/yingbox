import { isSearchCommand } from '@/utils/search-command'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import {
  fuseSearch,
  routeSearch,
  searchLibrary,
  searchLibraryBridge,
} from '@/features/library'
import { netdisk, netdiskAvailable } from '@/features/netdisk'
import { getSetting, settingsReady } from '@/features/settings'
import { externalResource, localResource } from './resources'
import { enhanceSearch, useSearchOnline } from './platform'
import { groupResources, normalize, parseQuery, searchAliases } from './rules'
import { type SearchTitle, enrichResource, lookupTitles } from './metadata'
import { type ProviderKind, SearchSession } from './session'
import type { RecallBatch } from '@/features/library'
import type { ResourceSearch, SearchResource, SourceState } from './types'

const PAGE_SIZE = 60
export function useResourceSearch(text: () => string): ResourceSearch {
  const resources = shallowRef<SearchResource[]>([])
  const states = shallowRef<Record<ProviderKind, SourceState>>()
  const online = useSearchOnline()
  const query = computed(() => parseQuery(text()))
  const metadataBusy = ref(false)
  const more = ref(false)
  const moreBusy = ref(false)
  let offset = 0
  let session: SearchSession | null = null
  let aiKeywords: string[] = []
  let titles: SearchTitle[] = []
  const works = computed(() => groupResources(resources.value, query.value))
  const busy = computed(
    () =>
      metadataBusy.value ||
      Object.values(states.value ?? {}).some(
        state => state.status === 'loading'
      )
  )

  async function local(
    current: SearchSession,
    keyword: string,
    retry = false
  ): Promise<void> {
    await current.run(
      'local',
      keyword,
      async () => {
        const api = searchLibraryBridge()
        if (!api) throw new Error('请先连接媒体库')
        const [page] = await Promise.all([
          api.query({
            source: 'tmdb',
            types: ['movie', 'series'],
            search: keyword,
            limit: PAGE_SIZE,
            offset: 0,
          }),
          searchLibrary(
            { text: keyword, scope: 'all', signal: current.signal },
            batch => {
              const batches: RecallBatch[] = [batch]
              current.publish(
                fuseSearch(batches, routeSearch(keyword)).flatMap(hit =>
                  hit.versions.map(item =>
                    localResource(item, hit.reasons.join(' · '))
                  )
                )
              )
            }
          ),
        ])
        current.publish(page.items.map(item => localResource(item)))
        if (
          current === session &&
          !current.signal.aborted &&
          keyword === query.value.keyword
        ) {
          offset = page.items.length
          more.value = offset < page.total
        }
      },
      retry
    )
  }

  async function external(
    current: SearchSession,
    keyword: string,
    retry = false,
    only?: 'online' | 'netdisk'
  ): Promise<void> {
    await Promise.all([
      online.available && only !== 'netdisk'
        ? current.run(
            'online',
            keyword,
            () =>
              online.search(keyword, current.signal, items =>
                current.publish(items)
              ),
            retry
          )
        : Promise.resolve(),
      netdiskAvailable && only !== 'online'
        ? current.run(
            'netdisk',
            keyword,
            async () => {
              await settingsReady
              if (current.signal.aborted) return
              const torznab = await netdisk().torznab()
              if (current.signal.aborted) return
              if (!getSetting('pan115.pansouUrl') && !torznab.urls.length) {
                current.status('netdisk', {
                  status: 'unconfigured',
                  message: '配置 PanSou 或 Torznab 后可查找 115 和磁力',
                })
                return '尚未配置 PanSou 或 Torznab'
              }
              const reply = await netdisk().search(keyword)
              if (!reply.ok) throw new Error(reply.error)
              current.publish(
                [...reply.items, ...reply.magnets].map(externalResource)
              )
              return reply.notes.join('；')
            },
            retry
          )
        : Promise.resolve(),
    ])
  }

  async function run(): Promise<void> {
    session?.cancel()
    resources.value = []
    states.value = undefined
    metadataBusy.value = false
    offset = 0
    more.value = false
    moreBusy.value = false
    aiKeywords = []
    titles = []
    const keyword = query.value.keyword
    if (!keyword || isSearchCommand(keyword)) return
    const current = new SearchSession((items, next) => {
      resources.value = items.map(item => enrichResource(item, titles))
      states.value = next
    })
    session = current
    metadataBusy.value = true
    const metadata = lookupTitles(query.value, current.signal)
      .then(found => {
        if (current.signal.aborted) return
        titles = found
        current.publish(
          resources.value.map(item => enrichResource(item, titles))
        )
      })
      .catch(() => {})
      .finally(() => {
        if (session === current) metadataBusy.value = false
      })
    const enhanced = current.run('ai', keyword, async () => {
      const result = await enhanceSearch(text(), current.signal)
      if (current.signal.aborted) return
      current.publish(result.resources)
      aiKeywords = result.keywords
      return result.message
    })
    await Promise.all([
      local(current, keyword),
      external(current, keyword),
      enhanced,
      metadata,
    ])
    if (current.signal.aborted) return
    const extra = [
      ...aiKeywords,
      ...titles.flatMap(title => [title.title, title.original]).filter(Boolean),
      ...searchAliases(resources.value, keyword),
    ]
      .filter(
        (value, index, all) =>
          normalize(value) !== normalize(keyword) &&
          all.findIndex(other => normalize(other) === normalize(value)) ===
            index
      )
      .slice(0, 2)
    // 少于五部有外部资源的确定匹配作品时，使用可信原名或已解析的片名补查。
    const covered = works.value.filter(
      work =>
        !work.possible &&
        work.resources.some(resource => resource.kind !== 'local')
    ).length
    if (covered < 5)
      for (const alias of extra) {
        if (current.signal.aborted) break
        await Promise.all([local(current, alias), external(current, alias)])
      }
  }

  async function retry(kind: ProviderKind): Promise<void> {
    const current = session
    if (!current) return
    if (kind === 'local') await local(current, query.value.keyword, true)
    else if (kind === 'ai')
      await current.run(
        'ai',
        query.value.keyword,
        async () => {
          const result = await enhanceSearch(text(), current.signal)
          current.publish(result.resources)
          return result.message
        },
        true
      )
    else await external(current, query.value.keyword, true, kind)
  }

  async function loadMore(): Promise<void> {
    const current = session
    if (!current || !more.value || moreBusy.value) return
    const api = searchLibraryBridge()
    if (!api) return
    moreBusy.value = true
    try {
      const page = await api.query({
        source: 'tmdb',
        types: ['movie', 'series'],
        search: query.value.keyword,
        limit: PAGE_SIZE,
        offset,
      })
      if (current.signal.aborted) return
      current.publish(page.items.map(item => localResource(item)))
      offset += page.items.length
      more.value = page.items.length > 0 && offset < page.total
    } catch (error) {
      current.status('local', {
        status: 'error',
        message: error instanceof Error ? error.message : '加载失败',
      })
    } finally {
      if (session === current) moreBusy.value = false
    }
  }

  watch(text, () => void run(), { immediate: true })
  onScopeDispose(() => session?.cancel())
  return {
    resources,
    states,
    works,
    query,
    busy,
    more,
    moreBusy,
    loadMore,
    retry,
    online,
    run,
  }
}
