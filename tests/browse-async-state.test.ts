// @vitest-environment jsdom
import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useVodBrowse } from '../src/renderer/src/features/online/composables/use-vod-browse'
import { useLiveEpg } from '../src/renderer/src/features/live/composables/use-live-epg'
import type { LiveChannel } from '../src/renderer/src/features/live/utils/playlist-parse'

const parser = vi.hoisted(() => ({ getConfig: vi.fn(), getCards: vi.fn() }))
vi.mock(
  '../src/renderer/src/features/online/composables/use-vod-parser',
  () => ({ useVODParser: () => parser })
)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('切换源后，旧分页响应不能追加到新源或覆盖加载状态', async () => {
  const browse = useVodBrowse()
  const source = (name: string): (typeof browse.sources.value)[number] => ({
    site: { name } as (typeof browse.sources.value)[number]['site'],
    tabs: [{ name: '电影', ext: {} }],
    loaded: true,
  })
  browse.sources.value = [
    source('A'),
    source('B'),
  ] as typeof browse.sources.value
  const old = deferred<{ success: boolean; data: unknown }>()
  const current = deferred<{ success: boolean; data: unknown }>()
  parser.getCards
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise)
  const first = browse.loadMore()
  const second = browse.switchSource(1)
  old.resolve({
    success: true,
    data: { list: [{ vod_id: 'old', vod_name: '旧源' }] },
  })
  await first
  expect(browse.cards.value).toEqual([])
  expect(browse.loading.value).toBe(true)
  current.resolve({
    success: true,
    data: { list: [{ vod_id: 'new', vod_name: '新源' }] },
  })
  await second
  expect(browse.cards.value.map(card => card.vod_id)).toEqual(['new'])
  expect(browse.currentPage.value).toBe(1)
  expect(browse.loading.value).toBe(false)
})

it('节目单清空与 IPC 抛错都结束等待，过期请求不再覆盖状态', async () => {
  const pending = deferred<{ ok: boolean }>()
  const loadEpg = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error('IPC 断开'))
  vi.stubGlobal('api', { iptv: { loadEpg, epgProgrammes: vi.fn() } })
  const scope = effectScope()
  const urls = ref(['https://example.com/epg'])
  const channels = ref([{ id: '1', name: '频道' }] as LiveChannel[])
  const epg = scope.run(() => useLiveEpg(channels, urls))!
  try {
    const first = epg.reload(false)
    expect(epg.loading.value).toBe(true)
    urls.value = []
    await epg.reload(false)
    expect(epg.loading.value).toBe(false)
    pending.resolve({ ok: false })
    await first
    expect(epg.error.value).toBe('')
    urls.value = ['https://example.com/epg']
    await epg.reload(false)
    expect(epg.loading.value).toBe(false)
    expect(epg.error.value).toBe('IPC 断开')
  } finally {
    scope.stop()
  }
})
